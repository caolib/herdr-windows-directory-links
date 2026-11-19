using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Windows .NET Framework 4.x / C# 5; metadata only, no shell or window APIs.
public static class DirectoryPolicy {
    const int MaxPath = 259;
    const uint DirectoryAttribute = 0x10, ReparseAttribute = 0x400;
    const uint SymlinkTag = 0xA000000C, JunctionTag = 0xA0000003;
    static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);
    static readonly UnicodeEncoding StrictUtf16 = new UnicodeEncoding(false, false, true);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,
        StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool DeviceIoControl(SafeFileHandle handle, uint control,
        IntPtr input, uint inputSize, [Out] byte[] output, uint outputSize,
        out uint returned, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint QueryDosDeviceW(string name, [Out] char[] target, uint size);

    [StructLayout(LayoutKind.Sequential)]
    struct FileInfo {
        public uint attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }

    static void Fail(string code) { throw new Exception(code); }

    static bool UnsafeText(string text) {
        for (int i = 0; i < text.Length; i++) {
            char c = text[i];
            if (Char.IsControl(c) || c == '\u061c' || c == '\u200e' || c == '\u200f' ||
                (c >= '\u202a' && c <= '\u202e') ||
                (c >= '\u2066' && c <= '\u2069') || c == '\ufeff') return true;
            if (Char.IsHighSurrogate(c)) {
                if (++i == text.Length || !Char.IsLowSurrogate(text[i])) return true;
            } else if (Char.IsLowSurrogate(c)) return true;
        }
        return false; // ZWJ / ZWNJ are intentionally not rejected.
    }

    static bool DriveAbsolute(string path) {
        return path.Length >= 3 && ((path[0] >= 'a' && path[0] <= 'z') ||
            (path[0] >= 'A' && path[0] <= 'Z')) && path[1] == ':' && path[2] == '\\';
    }

    static bool Reserved(string part) {
        int dot = part.IndexOf('.');
        string stem = (dot < 0 ? part : part.Substring(0, dot)).TrimEnd(' ');
        if (String.Equals(stem, "CON", StringComparison.OrdinalIgnoreCase) ||
            String.Equals(stem, "PRN", StringComparison.OrdinalIgnoreCase) ||
            String.Equals(stem, "AUX", StringComparison.OrdinalIgnoreCase) ||
            String.Equals(stem, "NUL", StringComparison.OrdinalIgnoreCase)) return true;
        if (stem.Length != 4 ||
            (!stem.StartsWith("COM", StringComparison.OrdinalIgnoreCase) &&
             !stem.StartsWith("LPT", StringComparison.OrdinalIgnoreCase))) return false;
        char number = stem[3];
        return (number >= '1' && number <= '9') || number == '\u00b9' ||
            number == '\u00b2' || number == '\u00b3';
    }

    static void CheckComponents(string text, bool allowRelativeDots) {
        if (text.IndexOfAny(new[] { '<', '>', '"', '|', '?', '*', ':', '/' }) >= 0)
            Fail("unsafe_path");
        foreach (string part in text.Split('\\')) {
            if (part.Length == 0) continue;
            if (part == "." || part == "..") {
                if (allowRelativeDots) continue;
                Fail("unsafe_path");
            }
            if (part[part.Length - 1] == '.' || part[part.Length - 1] == ' ' || Reserved(part))
                Fail("unsafe_path");
        }
    }

    public static void CheckPath(string path) {
        if (String.IsNullOrEmpty(path) || !DriveAbsolute(path) || UnsafeText(path))
            Fail("unsafe_path");
        if (path.Length > MaxPath) Fail("path_too_long");
        CheckComponents(path.Substring(3), false);
    }

    static int Hex(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }

    // Do not use System.Uri: it normalizes dot segments before policy checks.
    // Each contiguous escaped byte run is decoded exactly once with strict UTF-8.
    public static string ParseUrl(string raw) {
        if (String.IsNullOrEmpty(raw) || raw.Length > 16384 || UnsafeText(raw) ||
            raw.Length < 11 || !raw.StartsWith("file:///", StringComparison.OrdinalIgnoreCase) ||
            !((raw[8] >= 'a' && raw[8] <= 'z') || (raw[8] >= 'A' && raw[8] <= 'Z')) ||
            raw[9] != ':' || raw[10] != '/' || Char.IsWhiteSpace(raw[raw.Length - 1]) ||
            raw.IndexOfAny(new[] { '\\', '?', '#' }) >= 0) Fail("invalid_url");
        StringBuilder decoded = new StringBuilder(raw.Length);
        byte[] bytes = new byte[raw.Length];
        for (int i = 8; i < raw.Length; ) {
            if (raw[i] != '%') { decoded.Append(raw[i++]); continue; }
            int count = 0;
            while (i < raw.Length && raw[i] == '%') {
                if (i + 2 >= raw.Length || Hex(raw[i + 1]) < 0 || Hex(raw[i + 2]) < 0)
                    Fail("invalid_url");
                byte value = (byte)((Hex(raw[i + 1]) << 4) | Hex(raw[i + 2]));
                if (value == 0x2f || value == 0x5c) Fail("invalid_url");
                bytes[count++] = value;
                i += 3;
            }
            try { decoded.Append(StrictUtf8.GetString(bytes, 0, count)); }
            catch (DecoderFallbackException) { Fail("invalid_url"); }
        }
        string urlPath = decoded.ToString();
        foreach (string part in urlPath.Split('/'))
            if (part == "." || part == "..") Fail("invalid_url");
        string path = urlPath.Replace('/', '\\');
        CheckPath(path);
        return path;
    }

    static void NativeFailure() { NativeFailure(Marshal.GetLastWin32Error()); }

    static void NativeFailure(int error) {
        if (error == 2 || error == 3 || error == 267) Fail("not_found");
        if (error == 5 || error == 32 || error == 33) Fail("access_denied");
        Fail("unsafe_final_path");
    }

    static string TrimPath(string path) {
        return path.Length == 3 ? path : path.TrimEnd('\\');
    }

    // Recognize local volume devices before querying/opening a drive root. In
    // particular, do not ask Windows to follow a DOS-device UNC / SMB mapping.
    static bool LocalDevice(string target) {
        foreach (string prefix in new[] { @"\Device\HarddiskVolume", @"\Device\CdRom",
                @"\Device\Ramdisk", @"\Device\ImDisk", @"\Device\VirtualDisk" }) {
            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
                target.Length == prefix.Length) continue;
            bool numeric = true;
            for (int i = prefix.Length; i < target.Length; i++)
                if (target[i] < '0' || target[i] > '9') { numeric = false; break; }
            if (numeric) return true;
        }
        return false;
    }

    // Returns a local SUBST destination to walk BEFORE opening its drive root.
    // Unknown drive device mappings fail closed rather than risk network I/O.
    static string CheckDrive(string path) {
        CheckPath(path);
        char[] buffer = new char[32768];
        uint length = QueryDosDeviceW(path.Substring(0, 2), buffer, (uint)buffer.Length);
        if (length == 0) {
            int error = Marshal.GetLastWin32Error();
            if (error == 2 || error == 3) Fail("nonlocal_drive");
            NativeFailure();
        }
        int end = Array.IndexOf(buffer, '\0');
        if (end <= 0 || end >= length) Fail("nonlocal_drive");
        string target = new string(buffer, 0, end);
        if (target.StartsWith(@"\??\", StringComparison.Ordinal)) {
            target = target.Substring(4);
            CheckPath(target); // UNC, devices and drive-relative targets rejected here.
            return target;
        }
        if (!LocalDevice(target)) Fail("nonlocal_drive");
        uint type = GetDriveTypeW(path.Substring(0, 3));
        if (type != 2 && type != 3 && type != 5 && type != 6) Fail("nonlocal_drive");
        return null;
    }

    sealed class WalkState : IDisposable {
        public readonly List<SafeFileHandle> handles = new List<SafeFileHandle>();
        int links;
        public void Link() { if (++links > 40) Fail("link_loop"); }
        public void Dispose() {
            for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose();
        }
    }

    static SafeFileHandle OpenMetadata(string path, WalkState state, out FileInfo info) {
        // FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY, FILE_SHARE_READ only.
        // The directory read right makes Windows enforce delete-sharing for rename.
        // No directory entries/content are read. OPEN_EXISTING,
        // BACKUP_SEMANTICS | OPEN_REPARSE_POINT. Keep checked ancestors alive and
        // deny write/delete sharing until Resolve returns. Never follow the leaf.
        SafeFileHandle handle = CreateFileW(path, 0x81, 1, IntPtr.Zero, 3,
            0x02200000, IntPtr.Zero);
        if (handle.IsInvalid) {
            int error = Marshal.GetLastWin32Error();
            handle.Dispose();
            NativeFailure(error);
        }
        state.handles.Add(handle);
        if (!GetFileInformationByHandle(handle, out info)) NativeFailure();
        return handle;
    }

    static string FinalName(SafeFileHandle handle) {
        StringBuilder buffer = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0) NativeFailure();
        if (length >= buffer.Capacity) Fail("path_too_long");
        string name = buffer.ToString();
        if (!name.StartsWith(@"\\?\", StringComparison.Ordinal) ||
            !DriveAbsolute(name.Substring(4))) Fail("unsafe_final_path");
        name = name.Substring(4);
        CheckPath(name);
        if (CheckDrive(name) != null) Fail("unsafe_final_path");
        return TrimPath(name);
    }

    static ushort U16(byte[] data, int offset) { return BitConverter.ToUInt16(data, offset); }
    static uint U32(byte[] data, int offset) { return BitConverter.ToUInt32(data, offset); }

    static string ReadTarget(SafeFileHandle handle, out bool relative) {
        byte[] data = new byte[16384];
        uint returned;
        if (!DeviceIoControl(handle, 0x000900A8, IntPtr.Zero, 0, data,
                (uint)data.Length, out returned, IntPtr.Zero)) NativeFailure();
        if (returned < 8 || returned > data.Length) Fail("unsupported_reparse");
        uint tag = U32(data, 0);
        int dataLength = U16(data, 4), header;
        relative = false;
        if (tag == SymlinkTag) header = 12;
        else if (tag == JunctionTag) header = 8;
        else { Fail("unsupported_reparse"); header = 0; }
        if (dataLength < header || dataLength + 8 > returned) Fail("unsupported_reparse");
        if (tag == SymlinkTag) {
            uint flags = U32(data, 16);
            if ((flags & ~1u) != 0) Fail("unsupported_reparse");
            relative = flags == 1;
        }
        int offset = U16(data, 8), size = U16(data, 10);
        int printOffset = U16(data, 12), printSize = U16(data, 14);
        int available = dataLength - header;
        if ((offset & 1) != 0 || (size & 1) != 0 || size == 0 ||
            offset + size > available || (printOffset & 1) != 0 ||
            (printSize & 1) != 0 || printOffset + printSize > available)
            Fail("unsupported_reparse");
        string target = null;
        try { target = StrictUtf16.GetString(data, 8 + header + offset, size); }
        catch (DecoderFallbackException) { Fail("unsupported_reparse"); }
        if (UnsafeText(target)) Fail("unsafe_path");
        return target; // SubstituteName is authoritative; PrintName is not trusted.
    }

    static string TargetPath(string target, bool relative, string parent) {
        if (relative) {
            if (target.Length == 0 || target[0] == '\\' || target[0] == '/' ||
                target.IndexOf(':') >= 0) Fail("unsafe_path");
            target = target.Replace('/', '\\');
            CheckComponents(target, true);
            try { target = Path.GetFullPath(parent + "\\" + target); }
            catch (Exception) { Fail("unsafe_path"); }
        } else if (target.StartsWith(@"\??\", StringComparison.Ordinal) ||
                   target.StartsWith(@"\\?\", StringComparison.Ordinal)) {
            target = target.Substring(4);
        }
        CheckPath(target); // Absolutely before joining suffixes or opening target.
        return target;
    }

    static string Append(string directory, string[] parts, int start) {
        StringBuilder result = new StringBuilder(TrimPath(directory));
        for (int i = start; i < parts.Length; i++) {
            if (result[result.Length - 1] != '\\') result.Append('\\');
            result.Append(parts[i]);
        }
        string path = result.ToString();
        CheckPath(path);
        return path;
    }

    static string Walk(string input, WalkState state) {
        CheckPath(input);
        string[] parts = input.Substring(3).Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
        string mapped = CheckDrive(input);
        if (mapped != null) {
            state.Link();
            string physical = Walk(mapped, state);
            return parts.Length == 0 ? physical : Walk(Append(physical, parts, 0), state);
        }
        string current = input.Substring(0, 3);
        string parent = current;
        // Include the drive root, even when the requested path has no components.
        for (int index = -1; index < parts.Length; index++) {
            if (index >= 0) {
                parent = current;
                current = current.TrimEnd('\\') + "\\" + parts[index];
                CheckPath(current);
            }
            FileInfo info;
            SafeFileHandle handle = OpenMetadata(current, state, out info);
            if ((info.attributes & ReparseAttribute) != 0) {
                state.Link();
                bool relative;
                string destination = TargetPath(ReadTarget(handle, out relative), relative, parent);
                // Validate target's drive before any access below the reparse point.
                string resolved = Walk(destination, state);
                return index + 1 == parts.Length ? resolved :
                    Walk(Append(resolved, parts, index + 1), state);
            }
            if ((info.attributes & DirectoryAttribute) == 0) Fail("not_directory");
            string final = FinalName(handle);
            // A different parent means the ancestor/mapping changed while walking.
            // Allow canonical casing and 8.3 expansion of this one checked leaf.
            if (index >= 0) {
                int separator = final.LastIndexOf('\\');
                string finalParent = separator == 2 ? final.Substring(0, 3) : final.Substring(0, separator);
                if (!String.Equals(TrimPath(parent), TrimPath(finalParent), StringComparison.OrdinalIgnoreCase))
                    Fail("path_changed");
            } else if (!String.Equals(current, final, StringComparison.OrdinalIgnoreCase)) Fail("path_changed");
            current = final;
        }
        // The last retained no-follow handle has already proved this is a real
        // directory with a checked canonical local path (including drive roots).
        return current;
    }

    // Keep the entire checked ancestry leased until the consumer finishes.
    // FILE_SHARE_READ denies write/delete replacement between check and use.
    public static T WithResolved<T>(string path, Func<string, T> consume) {
        CheckPath(path);
        using (WalkState state = new WalkState()) {
            return consume(Walk(path, state));
        }
    }

    public static string Resolve(string path) {
        CheckPath(path);
        try {
            return WithResolved(path, resolved => resolved);
        } catch (Exception error) {
            // Never leak framework/native exception messages containing path text.
            if (error.GetType() == typeof(Exception) && Array.IndexOf(new[] {
                    "unsafe_path", "path_too_long", "nonlocal_drive", "not_found", "not_directory", "access_denied",
                    "unsafe_final_path", "unsafe_final_path", "unsupported_reparse", "path_changed", "link_loop"
                }, error.Message) >= 0) throw;
            throw new Exception("unsafe_final_path");
        }
    }
}
