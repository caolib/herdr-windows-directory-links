using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

public static class HerdrDirectoryShell {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,
        StringBuilder path, uint size, uint flags);
    [StructLayout(LayoutKind.Sequential)]
    struct FileInfo {
        public uint attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ExecuteInfo {
        public uint size, mask;
        public IntPtr window;
        public string verb, file, parameters, directory;
        public int show;
        public IntPtr instance, idList;
        public string className;
        public IntPtr classKey;
        public uint hotKey;
        public IntPtr icon, process;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ShellExecuteExW(ref ExecuteInfo info);

    static void CheckLocal(string path) {
        if (String.IsNullOrEmpty(path) || path.Length > 259 ||
            !System.Text.RegularExpressions.Regex.IsMatch(path, @"^[A-Za-z]:\\") ||
            path.Substring(2).IndexOf(':') >= 0 || path.IndexOf('"') >= 0 ||
            path.IndexOf('\0') >= 0) throw new Exception("unsafe_path");
        uint type = GetDriveTypeW(path.Substring(0, 3));
        if (type != 2 && type != 3 && type != 5 && type != 6)
            throw new Exception("nonlocal_drive");
    }
    public static string Run(string path, bool open) {
        CheckLocal(path);
        // Metadata only; keep handle alive and deny delete sharing while launching.
        using (SafeFileHandle handle = CreateFileW(path, 0, 3, IntPtr.Zero,
                3, 0x02200000, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            FileInfo info;
            if (!GetFileInformationByHandle(handle, out info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.attributes & 0x400) != 0) throw new Exception("path_changed");
            if ((info.attributes & 0x10) == 0) throw new Exception("not_directory");
            StringBuilder buffer = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandleW(handle, buffer, 32768, 0);
            if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (length >= 32768) throw new Exception("path_too_long");
            string final = buffer.ToString();
            if (!final.StartsWith(@"\\?\") || final.StartsWith(@"\\?\UNC\",
                StringComparison.OrdinalIgnoreCase)) throw new Exception("unsafe_final_path");
            final = final.Substring(4);
            CheckLocal(final);
            if (!String.Equals(Path.GetFullPath(path).TrimEnd('\\'),
                final.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                throw new Exception("path_changed");
            if (open) {
                ExecuteInfo execute = new ExecuteInfo();
                execute.size = (uint)Marshal.SizeOf(typeof(ExecuteInfo));
                execute.mask = 0x00000500; // NOASYNC | FLAG_NO_UI; no env expansion.
                execute.verb = "explore";
                execute.file = final; // Literal Unicode filename, NOT a command line.
                execute.parameters = null;
                execute.show = 1;
                if (!ShellExecuteExW(ref execute))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            return final;
        }
    }
    public static string RealPathFile(string path) {
        CheckLocal(path);
        using (SafeFileHandle handle = CreateFileW(path, 0, 7, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var result = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandleW(handle, result, 32768, 0);
            if (length == 0 || length >= 32768) throw new Exception("unsafe_final_path");
            string final = result.ToString();
            if (!final.StartsWith(@"\\?\") || final.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
                throw new Exception("unsafe_final_path");
            final = final.Substring(4);
            CheckLocal(final);
            return final;
        }
    }
    public static string HostHash() {
        using (RegistryKey root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
        using (RegistryKey key = root.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography")) {
            string guid = key == null ? null : key.GetValue("MachineGuid") as string;
            if (String.IsNullOrWhiteSpace(guid)) throw new Exception("host_unavailable");
            using (SHA256 sha = SHA256.Create()) {
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(guid)))
                    .Replace("-", "").ToLowerInvariant();
            }
        }
    }
    static object Facts() {
        var local = new List<string>();
        foreach (DriveInfo drive in DriveInfo.GetDrives()) {
            DriveType type = drive.DriveType;
            if (type == DriveType.Fixed || type == DriveType.Removable ||
                type == DriveType.CDRom || type == DriveType.Ram) local.Add(drive.Name);
        }
        return new { host = HostHash(), drives = local };
    }
    static string ReadRequestLine() {
        var line = new StringBuilder();
        int value;
        while ((value = Console.In.Read()) != -1 && value != '\n') {
            if (line.Length >= 32768) throw new Exception("invalid_operation");
            line.Append((char)value);
        }
        return line.Length == 0 && value == -1 ? null : line.ToString();
    }
    [STAThread]
    public static int Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            if (args.Length == 1 && (args[0] == "--click" || args[0] == "--validate-click")) {
                using (var timeout = new System.Threading.Timer(_ => {
                    Console.Error.WriteLine("operation_timeout"); Environment.Exit(1);
                }, null, 15000, System.Threading.Timeout.Infinite)) {
                    bool open = args[0] == "--click";
                    string resolved = ClickRuntime.Run(open);
                    if (open) Console.WriteLine("[windows-directory-links] opened local directory");
                    else Console.WriteLine(new JavaScriptSerializer().Serialize(new { path = resolved, opened = false }));
                    return 0;
                }
            }
            if (args.Length == 1 && args[0] == "--policy-test") {
                var policyJson = new JavaScriptSerializer { MaxJsonLength = 1048576 };
                var requests = policyJson.Deserialize<Dictionary<string, object>[]>(Console.In.ReadToEnd());
                var results = new List<object>();
                foreach (var policyRequest in requests) {
                    try {
                        string op = policyRequest["operation"] as string;
                        string value = policyRequest["value"] as string;
                        string result;
                        if (op == "parse") result = DirectoryPolicy.ParseUrl(value);
                        else if (op == "resolve") result = DirectoryPolicy.Resolve(value);
                        else if (op == "lease-test") {
                            result = DirectoryPolicy.WithResolved(value, resolved => {
                                // Test fixtures only: both leaf and checked parent stay leased.
                                foreach (string candidate in new[] { resolved, Path.GetDirectoryName(resolved) }) {
                                    bool blocked = false;
                                    try { Directory.Move(candidate, candidate + ".rename-test"); }
                                    catch (IOException) { blocked = true; }
                                    if (!blocked) {
                                        Directory.Move(candidate + ".rename-test", candidate);
                                        throw new Exception("path_changed");
                                    }
                                }
                                return Run(resolved, false);
                            });
                        }
                        else throw new Exception("invalid_operation");
                        results.Add(new { path = result });
                    } catch (Exception error) {
                        results.Add(new { error = ErrorCode(error) });
                    }
                }
                Console.WriteLine(policyJson.Serialize(results));
                return 0;
            }
            if (args.Length == 1 && args[0] == "--session") {
                // Exactly two stages, one invocation. EOF aborts without opening.
                var sessionJson = new JavaScriptSerializer { MaxJsonLength = 32768 };
                string first = ReadRequestLine();
                if (first == null) return 0;
                var factsRequest = sessionJson.Deserialize<Dictionary<string, object>>(first);
                if ((factsRequest["operation"] as string) != "facts") throw new Exception("invalid_operation");
                Console.WriteLine(sessionJson.Serialize(Facts()));
                Console.Out.Flush();
                string second = ReadRequestLine();
                if (second == null) return 0;
                var finalRequest = sessionJson.Deserialize<Dictionary<string, object>>(second);
                string finalOperation = finalRequest["operation"] as string;
                if (finalOperation != "open" && finalOperation != "validate") throw new Exception("invalid_operation");
                string finalPath = Run(finalRequest["path"] as string, finalOperation == "open");
                Console.WriteLine(sessionJson.Serialize(new { path = finalPath, opened = finalOperation == "open" }));
                return 0;
            }
            if (args.Length != 0) throw new Exception("invalid_operation");
            // Bounded input. No path or URL is ever interpreted as code or argv.
            char[] buffer = new char[32769];
            int total = 0, count;
            while (total < buffer.Length && (count = Console.In.Read(buffer, total, buffer.Length - total)) > 0)
                total += count;
            if (total == buffer.Length) throw new Exception("invalid_operation");
            JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 32768 };
            var request = json.Deserialize<Dictionary<string, object>>(new string(buffer, 0, total));
            string operation = request["operation"] as string;
            object response;
            if (operation == "host") {
                response = new { host = HostHash() };
            } else if (operation == "drives" || operation == "facts") {
                var local = new List<string>();
                foreach (DriveInfo drive in DriveInfo.GetDrives()) {
                    DriveType type = drive.DriveType;
                    if (type == DriveType.Fixed || type == DriveType.Removable ||
                        type == DriveType.CDRom || type == DriveType.Ram) local.Add(drive.Name);
                }
                response = operation == "facts"
                    ? (object)new { host = HostHash(), drives = local }
                    : (object)new { drives = local };
            } else if (operation == "validate" || operation == "open") {
                string resolved = Run(request["path"] as string, operation == "open");
                response = new { path = resolved, opened = operation == "open" };
            } else throw new Exception("invalid_operation");
            Console.WriteLine(json.Serialize(response));
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(ErrorCode(error));
            return 1;
        }
    }
    static string ErrorCode(Exception error) {
        Win32Exception native = error as Win32Exception;
        if (native != null) return "win32_" + native.NativeErrorCode;
        if (error is FileNotFoundException || error is DirectoryNotFoundException) return "not_found";
        if (error is UnauthorizedAccessException) return "access_denied";
        if (Array.IndexOf(new[] { "invalid_operation", "unsafe_path", "nonlocal_drive",
            "not_directory", "path_too_long", "unsafe_final_path", "path_changed", "host_unavailable",
            "invalid_url", "invalid_context", "unbound_host", "unverified_pane", "remote_pane",
            "helper_cache_invalid", "link_loop", "unsupported_reparse", "not_found", "access_denied" }, error.Message) >= 0)
            return error.Message;
        return "native_failure";
    }
}
