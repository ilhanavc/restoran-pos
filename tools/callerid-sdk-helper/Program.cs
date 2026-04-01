using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class Program
{
    // Vendor examples (C#/C++) imply cdecl + 5 string params for CallerID and 6 params for Signal.
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void CallerIdCallback(
        [MarshalAs(UnmanagedType.BStr)] string deviceSerial,
        [MarshalAs(UnmanagedType.BStr)] string line,
        [MarshalAs(UnmanagedType.BStr)] string phoneNumber,
        [MarshalAs(UnmanagedType.BStr)] string dateTime,
        [MarshalAs(UnmanagedType.BStr)] string other
    );

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SignalCallback(
        [MarshalAs(UnmanagedType.BStr)] string deviceModel,
        [MarshalAs(UnmanagedType.BStr)] string deviceSerial,
        int signal1,
        int signal2,
        int signal3,
        int signal4
    );

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SetEventsDelegate(CallerIdCallback callerIdEvent, SignalCallback signalEvent);

    private static readonly HttpClient Http = new();
    private static readonly object Gate = new();
    private static readonly Dictionary<string, DateTime> LastSeenByKey = new();

    // Keep delegate references rooted to prevent GC.
    private static CallerIdCallback? _callerIdHandler;
    private static SignalCallback? _signalHandler;
    private static SetEventsDelegate? _setEvents;
    private static nint _libHandle;

    private static string _bridgeUrl = "http://127.0.0.1:3001/api/bridge/caller-id/incoming";
    private static string _bridgeToken = string.Empty;
    private static string _sourceType = "callerid_sdk_helper";
    private static bool _postEnabled;
    private static int _debounceMs = 1800;
    private static int _debounceStateTtlMs = 5 * 60 * 1000;

    private static int Main(string[] args)
    {
        try
        {
            LoadRuntimeConfig(args);
            var dllPath = ResolveDllPath(args);
            var processArch = Environment.Is64BitProcess ? "x64" : "x86";
            var apiBase = _bridgeUrl.EndsWith("/bridge/caller-id/incoming", StringComparison.OrdinalIgnoreCase)
                ? _bridgeUrl[..^"/bridge/caller-id/incoming".Length]
                : _bridgeUrl;

            Console.WriteLine("[callerid-sdk-helper][startup] booting");
            Console.WriteLine($"[callerid-sdk-helper][startup] process_arch={processArch}");
            Console.WriteLine($"[callerid-sdk-helper][startup] api_base={apiBase}");
            Console.WriteLine($"[callerid-sdk-helper][startup] source_type={_sourceType}");
            Console.WriteLine($"[callerid-sdk-helper][startup] post_enabled={_postEnabled}");
            Console.WriteLine($"[callerid-sdk-helper][startup] selected_dll_path={dllPath}");

            RegisterCallbacks(dllPath);

            Console.WriteLine("[callerid-sdk-helper][startup] ready waiting_for_events=true");
            Console.WriteLine("[callerid-sdk-helper][startup] press_ctrl_c_to_exit");

            using var quit = new ManualResetEventSlim(false);
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                quit.Set();
            };
            quit.Wait();
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[callerid-sdk-helper][fatal] message={ex.Message}");
            return 1;
        }
        finally
        {
            if (_libHandle != 0)
            {
                NativeLibrary.Free(_libHandle);
            }
        }
    }

    private static void LoadRuntimeConfig(string[] args)
    {
        var apiBase = GetArg(args, "--api-base")
            ?? Environment.GetEnvironmentVariable("API_BASE")
            ?? "http://127.0.0.1:3001/api";
        _bridgeUrl = $"{apiBase.TrimEnd('/')}/bridge/caller-id/incoming";

        _bridgeToken = GetArg(args, "--bridge-token")
            ?? Environment.GetEnvironmentVariable("BRIDGE_TOKEN")
            ?? string.Empty;

        _sourceType = GetArg(args, "--source-type")
            ?? Environment.GetEnvironmentVariable("CALLERID_SOURCE_TYPE")
            ?? "callerid_sdk_helper";

        var postArg = GetArg(args, "--post-enabled");
        var postEnv = Environment.GetEnvironmentVariable("CALLERID_HELPER_POST_ENABLED");
        _postEnabled = ParseBool(postArg) || ParseBool(postEnv);

        var debounceArg = GetArg(args, "--debounce-ms");
        var debounceEnv = Environment.GetEnvironmentVariable("CALLERID_HELPER_DEBOUNCE_MS");
        if (int.TryParse(debounceArg ?? debounceEnv, out var parsed) && parsed >= 0)
        {
            _debounceMs = parsed;
        }

        if (_postEnabled && string.IsNullOrWhiteSpace(_bridgeToken))
        {
            throw new InvalidOperationException("POST açıkken bridge token gerekli (--bridge-token veya BRIDGE_TOKEN).");
        }
    }

    private static string ResolveDllPath(string[] args)
    {
        var custom = GetArg(args, "--dll-path");
        if (!string.IsNullOrWhiteSpace(custom))
        {
            return Path.GetFullPath(custom);
        }

        var root = AppContext.BaseDirectory;
        var envSpecific = Environment.Is64BitProcess
            ? Environment.GetEnvironmentVariable("CID_DLL_X64_PATH")
            : Environment.GetEnvironmentVariable("CID_DLL_X86_PATH");
        if (!string.IsNullOrWhiteSpace(envSpecific))
        {
            return Path.GetFullPath(envSpecific);
        }

        var rel = Environment.Is64BitProcess ? "cidshow_x64\\cid.dll" : "cidshow_x86\\cid.dll";
        return Path.GetFullPath(Path.Combine(root, rel));
    }

    private static void RegisterCallbacks(string dllPath)
    {
        if (!File.Exists(dllPath))
        {
            Console.WriteLine($"[callerid-sdk-helper][startup][dll] file_exists=false path={dllPath}");
            throw new FileNotFoundException($"cid.dll bulunamadı: {dllPath}");
        }
        Console.WriteLine($"[callerid-sdk-helper][startup][dll] file_exists=true path={dllPath}");

        try
        {
            _libHandle = NativeLibrary.Load(dllPath);
            Console.WriteLine($"[callerid-sdk-helper][startup][dll] load_success=true handle=0x{_libHandle:X}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[callerid-sdk-helper][startup][dll] load_success=false error={ex.Message}");
            throw;
        }

        nint setEventsPtr;
        try
        {
            setEventsPtr = NativeLibrary.GetExport(_libHandle, "SetEvents");
            Console.WriteLine($"[callerid-sdk-helper][startup][setevents] export_found=true ptr=0x{setEventsPtr:X}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[callerid-sdk-helper][startup][setevents] export_found=false error={ex.Message}");
            throw;
        }

        try
        {
            _setEvents = Marshal.GetDelegateForFunctionPointer<SetEventsDelegate>(setEventsPtr);
            Console.WriteLine("[callerid-sdk-helper][startup][setevents] delegate_bind_success=true");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[callerid-sdk-helper][startup][setevents] delegate_bind_success=false error={ex.Message}");
            throw;
        }

        _callerIdHandler = OnCallerId;
        _signalHandler = OnSignal;
        try
        {
            _setEvents(_callerIdHandler, _signalHandler);
            Console.WriteLine("[callerid-sdk-helper][startup][callbacks] registration_success=true");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[callerid-sdk-helper][startup][callbacks] registration_success=false error={ex.Message}");
            throw;
        }
    }

    private static void OnCallerId(string deviceSerial, string line, string phoneNumber, string dateTime, string other)
    {
        try
        {
            var rawDeviceSerialFilled = !string.IsNullOrWhiteSpace(deviceSerial);
            var rawLineFilled = !string.IsNullOrWhiteSpace(line);
            var rawPhoneFilled = !string.IsNullOrWhiteSpace(phoneNumber);
            var rawDateTimeFilled = !string.IsNullOrWhiteSpace(dateTime);
            var rawOtherFilled = !string.IsNullOrWhiteSpace(other);
            Console.WriteLine(
                $"[callerid-sdk-helper][event] raw_fields deviceSerial={(rawDeviceSerialFilled ? "filled" : "empty")} line={(rawLineFilled ? "filled" : "empty")} phone={(rawPhoneFilled ? "filled" : "empty")} dateTime={(rawDateTimeFilled ? "filled" : "empty")} other={(rawOtherFilled ? "filled" : "empty")}");

            var digits = NormalizeDigits(phoneNumber);
            Console.WriteLine($"[callerid-sdk-helper][event] normalized_phone={digits}");

            var passedFilter = digits.Length is 10 or 11;
            Console.WriteLine($"[callerid-sdk-helper][event] phone_filter_10_11={(passedFilter ? "passed" : "rejected")}");

            if (digits.Length is not (10 or 11))
            {
                Console.WriteLine($"[callerid-sdk-helper][skip] invalidDigits raw={phoneNumber}");
                return;
            }

            var isDebounced = IsDebounced(digits, line);
            Console.WriteLine($"[callerid-sdk-helper][event] debounce={(isDebounced ? "ignored" : "accepted")} debounce_ms={_debounceMs}");
            if (isDebounced)
            {
                Console.WriteLine($"[callerid-sdk-helper][skip] debounced phone={digits}");
                return;
            }

            if (!_postEnabled)
            {
                Console.WriteLine($"[callerid-sdk-helper][log-only] phone={digits} post_enabled=false");
                return;
            }

            Console.WriteLine($"[callerid-sdk-helper][post] dispatching phone={digits} endpoint={_bridgeUrl} source_type={_sourceType}");
            _ = PostIncomingAsync(digits, deviceSerial, line, dateTime, other);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[callerid-sdk-helper][event-error] stage=callback_processing error={ex.Message}");
        }
    }

    private static void OnSignal(string deviceModel, string deviceSerial, int signal1, int signal2, int signal3, int signal4)
    {
        Console.WriteLine(
            $"[callerid-sdk-helper][signal] model={deviceModel} serial={deviceSerial} levels={signal1}/{signal2}/{signal3}/{signal4}");
    }

    private static bool IsDebounced(string digits, string line)
    {
        lock (Gate)
        {
            var now = DateTime.UtcNow;
            CleanupDebounceState(now);

            var key = BuildDebounceKey(digits, line);
            if (LastSeenByKey.TryGetValue(key, out var lastSeenAt) &&
                (now - lastSeenAt).TotalMilliseconds < _debounceMs)
            {
                return true;
            }
            LastSeenByKey[key] = now;
            return false;
        }
    }

    private static string BuildDebounceKey(string digits, string line)
    {
        var normDigits = NormalizeDigits(digits);
        var normLine = string.IsNullOrWhiteSpace(line) ? "-" : line.Trim().ToLowerInvariant();
        return $"{normDigits}|{normLine}";
    }

    private static void CleanupDebounceState(DateTime now)
    {
        if (LastSeenByKey.Count == 0)
        {
            return;
        }

        var cutoff = now.AddMilliseconds(-_debounceStateTtlMs);
        var staleKeys = new List<string>();
        foreach (var kv in LastSeenByKey)
        {
            if (kv.Value < cutoff)
            {
                staleKeys.Add(kv.Key);
            }
        }

        foreach (var key in staleKeys)
        {
            LastSeenByKey.Remove(key);
        }
    }

    private static async Task PostIncomingAsync(string phone, string deviceSerial, string line, string dateTime, string other)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, _bridgeUrl);
            req.Headers.Add("X-Bridge-Token", _bridgeToken);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            var payload = new
            {
                phone,
                source_type = _sourceType,
                raw_payload = new
                {
                    device_serial = deviceSerial,
                    line,
                    date_time = dateTime,
                    other,
                    helper = "callerid-sdk-helper"
                }
            };

            req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            using var res = await Http.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                Console.WriteLine($"[callerid-sdk-helper][post-error] status={(int)res.StatusCode} body={body}");
                return;
            }

            Console.WriteLine($"[callerid-sdk-helper][posted] phone={phone} response={body}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[callerid-sdk-helper][post-exception] {ex.Message}");
        }
    }

    private static string NormalizeDigits(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var chars = raw.Where(char.IsDigit).ToArray();
        return new string(chars);
    }

    private static bool ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }
        return raw == "1" || raw.Equals("true", StringComparison.OrdinalIgnoreCase);
    }

    private static string? GetArg(string[] args, string key)
    {
        for (var i = 0; i < args.Length; i++)
        {
            if (!string.Equals(args[i], key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal))
            {
                return args[i + 1];
            }
            return "true";
        }

        return null;
    }
}
