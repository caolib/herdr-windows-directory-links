using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// Entire click path is in one process. No subprocess, service or remote fallback.
public static class ClickRuntime {
    const string PluginId = "local.windows-directory-links";
    const string HandlerId = "local-directory";
    static readonly string[] SourceNames = {
        "windows-shell.cs", "directory-policy.cs", "click-runtime.cs", "windows-shell.ps1"
    };
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    static extern Microsoft.Win32.SafeHandles.SafePipeHandle CreateFileW(string name, uint access,
        uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    static extern bool WaitNamedPipeW(string name, uint timeout);
    static NamedPipeClientStream ConnectLocal(string socket) {
        // .NET Framework path validation rejects ':' in Herdr's pipe name.
        // Open the exact local Win32 name, then wrap its overlapped handle.
        string name = @"\\.\pipe\" + socket;
        var handle = CreateFileW(name, 0xC0000000, 0, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
        if (handle.IsInvalid) {
            handle.Dispose();
            if (!WaitNamedPipeW(name, 5000)) throw Error("unverified_pane");
            handle = CreateFileW(name, 0xC0000000, 0, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
        }
        if (handle.IsInvalid) { handle.Dispose(); throw Error("unverified_pane"); }
        try { return new NamedPipeClientStream(PipeDirection.InOut, true, true, handle); }
        catch { handle.Dispose(); throw; }
    }
    static string Env(string name) { return Environment.GetEnvironmentVariable(name); }
    static Exception Error(string code) { return new Exception(code); }
    static Dictionary<string, object> Object(object value, string code) {
        var result = value as Dictionary<string, object>;
        if (result == null) throw Error(code);
        return result;
    }
    static string Text(Dictionary<string, object> value, string key) {
        object result;
        return value.TryGetValue(key, out result) ? result as string : null;
    }
    static Dictionary<string, object> Json(string text, string code) {
        if (text == null || text.Length > 1048576) throw Error(code);
        try {
            return Object(new JavaScriptSerializer { MaxJsonLength = 1048576, RecursionLimit = 32 }
                .DeserializeObject(text), code);
        } catch { throw Error(code); }
    }
    static string Hash(byte[] data) {
        using (SHA256 sha = SHA256.Create()) {
            return BitConverter.ToString(sha.ComputeHash(data)).Replace("-", "").ToLowerInvariant();
        }
    }
    static void VerifyExecutable() {
        // Detect stale/corrupt local build, not an attacker who controls all files.
        string executable = Assembly.GetExecutingAssembly().Location;
        string root = Path.GetDirectoryName(Path.GetDirectoryName(executable));
        try {
            if (Hash(File.ReadAllBytes(executable)) != File.ReadAllText(executable + ".sha256").Trim())
                throw Error("helper_cache_invalid");
            using (var bytes = new MemoryStream()) {
                foreach (string name in SourceNames) {
                    byte[] data = File.ReadAllBytes(Path.Combine(root, name));
                    bytes.Write(data, 0, data.Length);
                }
                if (Hash(bytes.ToArray()) != File.ReadAllText(executable + ".source-sha256").Trim())
                    throw Error("helper_cache_invalid");
            }
        } catch { throw Error("helper_cache_invalid"); }
    }
    static bool SamePath(string left, string right) {
        return left != null && right != null && String.Equals(Path.GetFullPath(left),
            Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);
    }
    static string Identifier(Dictionary<string, object> context, string field, string env) {
        string value = Text(context, field);
        if (String.IsNullOrEmpty(value) || value.Length > 128 || value.StartsWith("-") ||
            value != Env(env)) throw Error("invalid_context");
        foreach (char ch in value) if (Char.IsControl(ch) || Char.IsSurrogate(ch)) throw Error("invalid_context");
        return value;
    }
    static Dictionary<string, object> Context() {
        var context = Json(Env("HERDR_PLUGIN_CONTEXT_JSON"), "invalid_context");
        if (Env("HERDR_ENV") != "1" || Env("HERDR_PLUGIN_ID") != PluginId ||
            Env("HERDR_PLUGIN_ACTION_ID") != "open-directory" ||
            Env("HERDR_PLUGIN_LINK_HANDLER_ID") != HandlerId ||
            Text(context, "invocation_source") != "link_click" ||
            Text(context, "link_handler_id") != HandlerId ||
            Text(context, "clicked_url") == null ||
            Text(context, "clicked_url") != Env("HERDR_PLUGIN_CLICKED_URL")) throw Error("invalid_context");
        Identifier(context, "focused_pane_id", "HERDR_PANE_ID");
        Identifier(context, "tab_id", "HERDR_TAB_ID");
        Identifier(context, "workspace_id", "HERDR_WORKSPACE_ID");
        return context;
    }
    static string BindHost() {
        if (!String.IsNullOrEmpty(Env("HERDR_REMOTE_KEYBINDINGS")) ||
            !String.IsNullOrEmpty(Env("HERDR_REMOTE_PREFERENCES_IDENTITY"))) throw Error("remote_pane");
        string socket = Env("HERDR_SOCKET_PATH"), binary = Env("HERDR_BIN_PATH");
        string config = Env("HERDR_PLUGIN_CONFIG_DIR");
        DirectoryPolicy.CheckPath(socket);
        DirectoryPolicy.CheckPath(binary);
        DirectoryPolicy.CheckPath(config);
        if (!String.Equals(Path.GetExtension(binary), ".exe", StringComparison.OrdinalIgnoreCase)) throw Error("unbound_host");
        Dictionary<string, object> binding;
        try { binding = Json(File.ReadAllText(Path.Combine(config, "local-host.json")), "unbound_host"); }
        catch { throw Error("unbound_host"); }
        object version;
        if (!binding.TryGetValue("version", out version) || !System.Object.Equals(version, 1) ||
            Text(binding, "host") != HerdrDirectoryShell.HostHash() ||
            !SamePath(Text(binding, "socket"), socket) ||
            !SamePath(Text(binding, "binary"), HerdrDirectoryShell.RealPathFile(binary))) throw Error("unbound_host");
        return Path.GetFullPath(socket);
    }
    static Dictionary<string, object> ReadResponse(NamedPipeClientStream pipe, string id) {
        var watch = System.Diagnostics.Stopwatch.StartNew();
        using (var data = new MemoryStream()) {
            byte[] chunk = new byte[4096];
            while (watch.ElapsedMilliseconds < 5000) {
                Task<int> read = pipe.ReadAsync(chunk, 0, chunk.Length);
                if (!read.Wait(Math.Max(1, 5000 - (int)watch.ElapsedMilliseconds))) throw Error("unverified_pane");
                int count = read.Result;
                if (count == 0) throw Error("unverified_pane");
                for (int index = 0; index < count; index++) {
                    if (chunk[index] == 10) {
                        var response = Json(new UTF8Encoding(false, true).GetString(data.ToArray()), "unverified_pane");
                        if (Text(response, "id") == id) return response;
                        data.SetLength(0);
                        data.Position = 0;
                    } else data.WriteByte(chunk[index]);
                    if (data.Length > 1048576) throw Error("unverified_pane");
                }
            }
        }
        throw Error("unverified_pane");
    }
    static void VerifyPane(string socket, Dictionary<string, object> context) {
        try {
            // Exact Herdr 0.9.5 Windows namespace mapping; only local server '.'.
            using (var pipe = ConnectLocal(socket)) {
                string id = "directory-links:" + Guid.NewGuid().ToString("N");
                var json = new JavaScriptSerializer();
                byte[] request = Encoding.UTF8.GetBytes(json.Serialize(new {
                    id = id, method = "pane.get", @params = new { pane_id = Text(context, "focused_pane_id") }
                }) + "\n");
                Task write = pipe.WriteAsync(request, 0, request.Length);
                if (!write.Wait(5000)) throw Error("unverified_pane");
                var response = ReadResponse(pipe, id);
                if (response.ContainsKey("error")) throw Error("unverified_pane");
                object resultObject, paneObject;
                if (!response.TryGetValue("result", out resultObject)) throw Error("unverified_pane");
                var result = Object(resultObject, "unverified_pane");
                if (Text(result, "type") != "pane_info" || !result.TryGetValue("pane", out paneObject)) throw Error("unverified_pane");
                var pane = Object(paneObject, "unverified_pane");
                if (Text(pane, "pane_id") != Text(context, "focused_pane_id") ||
                    Text(pane, "tab_id") != Text(context, "tab_id") ||
                    Text(pane, "workspace_id") != Text(context, "workspace_id")) throw Error("unverified_pane");
            }
        } catch { throw Error("unverified_pane"); }
    }
    public static string Run(bool open) {
        VerifyExecutable();
        var context = Context();
        string target = DirectoryPolicy.ParseUrl(Text(context, "clicked_url"));
        string socket = BindHost();
        VerifyPane(socket, context);
        return DirectoryPolicy.WithResolved(target,
            resolved => HerdrDirectoryShell.Run(resolved, open));
    }
}
