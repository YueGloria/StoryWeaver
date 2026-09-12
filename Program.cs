using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace StoryWeaver;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        var headless = args.Contains("--headless", StringComparer.OrdinalIgnoreCase);
        var requestedPort = ReadPort(args);
        using var server = new LocalServer(requestedPort);
        server.Start();

        if (headless)
        {
            using var gate = new ManualResetEventSlim(false);
            Console.CancelKeyPress += (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                gate.Set();
            };
            gate.Wait();
            return;
        }

        Application.Run(new LauncherForm(server.Url, server.CacheDirectory));
    }

    private static int ReadPort(string[] args)
    {
        var index = Array.FindIndex(args, value => value.Equals("--port", StringComparison.OrdinalIgnoreCase));
        return index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out var port)
            ? port
            : 0;
    }
}

internal sealed class LauncherForm : Form
{
    public LauncherForm(string url, string cacheDirectory)
    {
        Text = "剧情脉络 · 本地服务";
        Width = 560;
        Height = 270;
        MinimumSize = new Size(520, 250);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(18, 23, 34);
        ForeColor = Color.FromArgb(239, 243, 251);
        Font = new Font("Microsoft YaHei UI", 10F);

        var title = new Label
        {
            Text = "剧情脉络已经就绪",
            Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(28, 24)
        };
        var hint = new Label
        {
            Text = "复制下面的网址，用浏览器打开。关闭此窗口会停止本地服务。",
            AutoSize = true,
            ForeColor = Color.FromArgb(170, 181, 204),
            Location = new Point(30, 62)
        };
        var urlBox = new TextBox
        {
            Text = url,
            ReadOnly = true,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.FromArgb(28, 35, 50),
            ForeColor = Color.White,
            Location = new Point(32, 98),
            Width = 370,
            Height = 34,
            Font = new Font("Consolas", 11F)
        };
        var copyButton = new Button
        {
            Text = "复制网址",
            Location = new Point(414, 96),
            Width = 105,
            Height = 36,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(83, 116, 255),
            ForeColor = Color.White,
            Cursor = Cursors.Hand
        };
        copyButton.FlatAppearance.BorderSize = 0;
        copyButton.Click += (_, _) =>
        {
            Clipboard.SetText(url);
            copyButton.Text = "已复制";
        };

        var cacheLabel = new Label
        {
            Text = $"缓存位置：{cacheDirectory}",
            AutoEllipsis = true,
            ForeColor = Color.FromArgb(126, 139, 165),
            Location = new Point(32, 152),
            Width = 486,
            Height = 24
        };
        var status = new Label
        {
            Text = "● 仅允许本机访问",
            ForeColor = Color.FromArgb(85, 211, 152),
            AutoSize = true,
            Location = new Point(32, 190)
        };

        Controls.AddRange([title, hint, urlBox, copyButton, cacheLabel, status]);
    }
}

internal sealed class LocalServer : IDisposable
{
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _cancellation = new();
    private Task? _acceptLoop;

    public string Url { get; private set; } = string.Empty;
    public string CacheDirectory { get; }

    public LocalServer(int requestedPort)
    {
        _listener = new TcpListener(IPAddress.Loopback, requestedPort);
        CacheDirectory = Path.Combine(AppContext.BaseDirectory, "cache");
    }

    public void Start()
    {
        Directory.CreateDirectory(CacheDirectory);
        _listener.Start();
        var endpoint = (IPEndPoint)_listener.LocalEndpoint;
        Url = $"http://127.0.0.1:{endpoint.Port}/";
        _acceptLoop = Task.Run(AcceptLoopAsync);
    }

    private async Task AcceptLoopAsync()
    {
        while (!_cancellation.IsCancellationRequested)
        {
            try
            {
                var client = await _listener.AcceptTcpClientAsync(_cancellation.Token);
                _ = Task.Run(() => HandleClientAsync(client));
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch when (_cancellation.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task HandleClientAsync(TcpClient client)
    {
        using (client)
        using (var stream = client.GetStream())
        {
            try
            {
                var request = await HttpRequestData.ReadAsync(stream, _cancellation.Token);
                if (request is null) return;

                if (request.Method == "GET" && request.Path == "/api/health")
                {
                    await WriteJsonAsync(stream, "{\"ok\":true}", 200);
                    return;
                }

                if (request.Method == "GET" && request.Path == "/api/project")
                {
                    var latestPath = Path.Combine(CacheDirectory, "latest.storymap.json");
                    var content = File.Exists(latestPath)
                        ? await File.ReadAllTextAsync(latestPath, Encoding.UTF8, _cancellation.Token)
                        : "null";
                    await WriteJsonAsync(stream, content, 200);
                    return;
                }

                if (request.Method == "POST" && request.Path == "/api/save")
                {
                    await SaveProjectAsync(request.Body);
                    await WriteJsonAsync(stream, "{\"ok\":true}", 200);
                    return;
                }

                if (request.Method == "GET")
                {
                    var resourcePath = request.Path is "/" or "/index.html"
                        ? "index.html"
                        : request.Path.TrimStart('/');
                    var allowedResources = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                    {
                        "index.html", "styles.css", "expression.js", "model.js", "app.js"
                    };
                    if (allowedResources.Contains(resourcePath))
                    {
                        await WriteResourceAsync(stream, resourcePath);
                        return;
                    }
                }

                await WriteTextAsync(stream, "Not found", "text/plain; charset=utf-8", 404);
            }
            catch (Exception exception)
            {
                try
                {
                    await WriteTextAsync(stream, exception.Message, "text/plain; charset=utf-8", 500);
                }
                catch
                {
                    // The browser may have already closed the connection.
                }
            }
        }
    }

    private async Task SaveProjectAsync(byte[] body)
    {
        if (body.Length == 0 || body.Length > 20 * 1024 * 1024)
            throw new InvalidDataException("保存内容为空或过大。");

        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;
        var project = root.TryGetProperty("project", out var projectElement) ? projectElement : root;
        var reason = root.TryGetProperty("reason", out var reasonElement)
            ? reasonElement.GetString() ?? "manual"
            : "manual";
        var json = JsonSerializer.Serialize(project, new JsonSerializerOptions { WriteIndented = true });

        var latestPath = Path.Combine(CacheDirectory, "latest.storymap.json");
        var temporaryPath = latestPath + ".tmp";
        await File.WriteAllTextAsync(temporaryPath, json, new UTF8Encoding(false), _cancellation.Token);
        File.Move(temporaryPath, latestPath, true);

        if (reason.Equals("autosave", StringComparison.OrdinalIgnoreCase))
        {
            var historyDirectory = Path.Combine(CacheDirectory, "history");
            Directory.CreateDirectory(historyDirectory);
            var historyPath = Path.Combine(historyDirectory, $"backup-{DateTime.Now:yyyyMMdd-HHmmss}.storymap.json");
            await File.WriteAllTextAsync(historyPath, json, new UTF8Encoding(false), _cancellation.Token);
        }
    }

    private static async Task WriteResourceAsync(NetworkStream stream, string fileName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = $"StoryWeaver.wwwroot.{fileName}";
        await using var resourceStream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new FileNotFoundException($"缺少网页资源：{fileName}");
        using var memory = new MemoryStream();
        await resourceStream.CopyToAsync(memory);
        var contentType = fileName.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
            ? "text/css; charset=utf-8"
            : fileName.EndsWith(".js", StringComparison.OrdinalIgnoreCase)
                ? "text/javascript; charset=utf-8"
                : "text/html; charset=utf-8";
        await WriteResponseAsync(stream, memory.ToArray(), contentType, 200);
    }

    private static Task WriteJsonAsync(NetworkStream stream, string json, int statusCode) =>
        WriteTextAsync(stream, json, "application/json; charset=utf-8", statusCode);

    private static Task WriteTextAsync(NetworkStream stream, string text, string contentType, int statusCode) =>
        WriteResponseAsync(stream, Encoding.UTF8.GetBytes(text), contentType, statusCode);

    private static async Task WriteResponseAsync(NetworkStream stream, byte[] content, string contentType, int statusCode)
    {
        var statusText = statusCode switch
        {
            200 => "OK",
            404 => "Not Found",
            _ => "Internal Server Error"
        };
        var header = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {statusCode} {statusText}\r\n" +
            $"Content-Type: {contentType}\r\n" +
            $"Content-Length: {content.Length}\r\n" +
            "Cache-Control: no-store\r\n" +
            "Connection: close\r\n\r\n");
        await stream.WriteAsync(header);
        await stream.WriteAsync(content);
    }

    public void Dispose()
    {
        _cancellation.Cancel();
        _listener.Stop();
        try { _acceptLoop?.Wait(TimeSpan.FromSeconds(2)); } catch { }
        _cancellation.Dispose();
    }
}

internal sealed record HttpRequestData(string Method, string Path, byte[] Body)
{
    public static async Task<HttpRequestData?> ReadAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var headerBuffer = new List<byte>(4096);
        var singleByte = new byte[1];
        while (headerBuffer.Count < 64 * 1024)
        {
            var read = await stream.ReadAsync(singleByte, cancellationToken);
            if (read == 0) return null;
            headerBuffer.Add(singleByte[0]);
            var count = headerBuffer.Count;
            if (count >= 4 && headerBuffer[count - 4] == 13 && headerBuffer[count - 3] == 10 &&
                headerBuffer[count - 2] == 13 && headerBuffer[count - 1] == 10)
                break;
        }

        var headerText = Encoding.UTF8.GetString(headerBuffer.ToArray());
        var lines = headerText.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0) return null;
        var requestParts = lines[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (requestParts.Length < 2) return null;

        var contentLength = 0;
        foreach (var line in lines.Skip(1))
        {
            var separator = line.IndexOf(':');
            if (separator <= 0) continue;
            if (line[..separator].Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
                int.TryParse(line[(separator + 1)..].Trim(), out contentLength);
        }
        if (contentLength > 20 * 1024 * 1024)
            throw new InvalidDataException("请求内容过大。");

        var body = new byte[contentLength];
        var offset = 0;
        while (offset < body.Length)
        {
            var read = await stream.ReadAsync(body.AsMemory(offset), cancellationToken);
            if (read == 0) break;
            offset += read;
        }

        var rawPath = requestParts[1].Split('?', 2)[0];
        return new HttpRequestData(requestParts[0].ToUpperInvariant(), Uri.UnescapeDataString(rawPath), body);
    }
}
