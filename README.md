# relay — frontend Vercel, backend Oracle VPS

Ứng dụng Next.js / TypeScript dành cho **một người**, giao diện tối bằng tiếng Việt. Dán link YouTube để xem video tối đa 360p / 720p hoặc chỉ nghe. Có khóa truy cập và lịch sử lưu trên trình duyệt.

**Đây là bản thử nghiệm, không phải cam kết vượt mọi chặn mạng.** Chỉ sử dụng nội dung bạn có quyền truy cập, theo chính sách mạng và điều khoản YouTube / Vercel / Oracle / Cloudflare. Không hỗ trợ Spotify ở bản này.

## Deploy Vercel + Oracle VPS (khuyến nghị)

```text
Browser ── tải giao diện/font ──> Vercel (Next.js)
Browser ── đăng nhập/API/media ─> Oracle VPS (Caddy → Next.js Node) ─> YouTube
```

API và media đi **trực tiếp** từ browser tới Oracle, không proxy qua Vercel. Vercel không chứa mật khẩu hoặc khóa ký. Backend dùng bearer token chỉ giữ trong bộ nhớ tab, CORS theo origin chính xác và HTTPS do Caddy cấp tự động.

### 1. Chuẩn bị VM và DNS

- Ubuntu 24.04 hoặc 22.04; Node.js 24.x.
- Shape `VM.Standard.A1.Flex` nếu lấy được capacity. `VM.Standard.E2.1.Micro` 1 GB vẫn chạy thử cho một người nhưng cần swap.
- Tạo bản ghi DNS `A`, ví dụ `api.example.com`, trỏ tới public IPv4 của VM. Nếu dùng Cloudflare DNS, chọn **DNS only** thay vì proxy để media thực sự đi qua Oracle.
- Trong OCI Security List/NSG chỉ mở TCP **22** từ IP quản trị của bạn và TCP **80/443** từ Internet. Không mở cổng 3001.

Trên VM 1 GB, tạo swap một lần trước khi build:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Cài Git, Node.js 24 và Caddy (nếu `apt install caddy` không có trong image, dùng repository chính thức tại [caddyserver.com/docs/install](https://caddyserver.com/docs/install)):

```bash
sudo apt update
sudo apt install -y git curl caddy
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

### 2. Cài backend Oracle

```bash
sudo install -d -o ubuntu -g ubuntu /opt/relay-private-player
git clone https://github.com/vanhiep99w/web-proxy.git /opt/relay-private-player
cd /opt/relay-private-player
npm ci
npm run setup:server -- https://api.example.com https://web-proxy-beta.vercel.app
npm run build:server
```

Thay hai origin bằng domain API và domain Vercel thật. `setup:server` tạo `.env.local` quyền `0600`, sinh mật khẩu ngẫu nhiên và `AUTH_SECRET`; script không ghi đè file đã tồn tại. Lưu mật khẩu vừa in vào trình quản lý mật khẩu. Không gửi hoặc commit `.env.local`.

Cài cấu hình Caddy sau khi DNS đã trỏ đúng:

```bash
cd /opt/relay-private-player
API_DOMAIN=api.your-domain.com
sed "s/api\\.example\\.com/${API_DOMAIN}/" deploy/oracle/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Thay `api.your-domain.com` bằng hostname API thật. Cài service Node:

```bash
sudo cp deploy/oracle/relay-private-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now relay-private-api
sudo systemctl status relay-private-api --no-pager
```

Service chỉ bind `127.0.0.1:3001`; Caddy là cổng public duy nhất. Xem lỗi bằng:

```bash
sudo journalctl -u relay-private-api -n 100 --no-pager
sudo journalctl -u caddy -n 100 --no-pager
```

Nếu user hoặc thư mục cài khác `ubuntu` / `/opt/relay-private-player`, sửa `User`, `Group`, `WorkingDirectory` trong file service trước khi copy.

### 3. Cấu hình frontend Vercel

Trong **Vercel → Project → Settings → Environment Variables**, đặt cho Production:

| Biến | Giá trị |
| --- | --- |
| `RELAY_MODE` | `vps` |
| `NEXT_PUBLIC_API_ORIGIN` | `https://api.example.com` |

Xóa/không đặt `ACCESS_PASSWORD`, `AUTH_SECRET`, `API_ORIGIN` và `FRONTEND_ORIGINS` trên Vercel. Redeploy frontend sau khi đổi biến. Các `/api/*` trên Vercel bị tắt ở chế độ `vps`.

Kiểm tra preflight trước khi mở giao diện:

```bash
curl -i -X OPTIONS https://api.example.com/api/auth \
  -H 'Origin: https://web-proxy-beta.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

Kết quả đúng là `204` và `Access-Control-Allow-Origin` khớp domain Vercel. Mở frontend, nhập mật khẩu mới, bấm **Kiểm tra backend Oracle VPS**, rồi thử video công khai ngắn. Mở trực tiếp URL API không có header `Origin` sẽ bị 403 theo thiết kế.

### 4. Cập nhật backend sau này

```bash
sudo systemctl stop relay-private-api
cd /opt/relay-private-player
git pull --ff-only
npm ci
npm run build:server
sudo systemctl start relay-private-api
```

YouTube vẫn có thể chặn IP datacenter Oracle (`UPSTREAM_BLOCKED`); VPS loại bỏ giới hạn CPU 10 ms của Workers Free nhưng không bảo đảm mọi video phát được.

## Tùy chọn: Deploy Vercel + Cloudflare (kết nối trực tiếp)

```text
Browser ── tải giao diện/font ──> Vercel (Next.js)
Browser ── đăng nhập/API/media ─> Cloudflare Worker ──> YouTube / googlevideo / ytimg
```

Media **không đi qua Vercel** và không cần máy nhà, VPS hay Cloudflare Tunnel. Worker là API độc lập, dùng chung các route/core với bản Next.js; không cần deploy toàn bộ Next.js lên Cloudflare hay dùng adapter Next.js.

### 1. Cloudflare backend

Dùng Node.js 24, chạy `npm ci`, rồi:

1. Chọn domain frontend ổn định, ví dụ `https://relay-cua-ban.vercel.app`.
2. Sửa `vars.FRONTEND_ORIGINS` trong **`wrangler.jsonc`** thành origin đó. Không kèm đường dẫn. Nhiều origin ngăn cách bằng dấu phẩy; không dùng `*` hoặc `*.vercel.app`. Preview Vercel phải được thêm từng origin rõ ràng. Cấu hình mặc định chỉ cho phép localhost để không vô tình mở API production.
3. Kiểm tra `name` và `ratelimits[0].namespace_id` không trùng ứng dụng khác trong tài khoản của bạn.
4. Đăng nhập và deploy:

```bash
npx wrangler login
npm run deploy:worker
npx wrangler secret put ACCESS_PASSWORD
npx wrangler secret put AUTH_SECRET
```

Nhập mật khẩu dài/ngẫu nhiên và khóa ít nhất 32 ký tự khi được hỏi. Tạo khóa bằng `openssl rand -hex 32`. **Không** đặt khóa/mật khẩu vào `vars`, Git, `NEXT_PUBLIC_*` hay môi trường Vercel. API từ chối truy cập khi chưa có secrets. Lấy URL HTTPS Worker từ kết quả deploy, hoặc cấu hình custom domain.

`nodejs_compat` và compatibility date trong Wrangler cho phép core dùng Node crypto và đọc secrets từ `process.env`; không thay đổi/mutate secrets giữa các request. `youtubei.js` được alias sang platform Cloudflare, QuickJS được alias sang loader WASM đã biên dịch sẵn.

**Nên dùng Workers Paid cho backend này.** Gói Free có CPU budget rất thấp (10 ms/request); parse player/metadata và giải mã có thể vượt giới hạn dù fetch/stream là bất đồng bộ. Local workerd không chứng minh workload nằm trong CPU/memory budget production. Xem [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) và chính sách [video delivery](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/).

### 2. Vercel frontend

Import repository, chọn **Next.js**, Node **24.x**, Build `npm run build`. Đặt:

| Biến trên Vercel | Giá trị |
| --- | --- |
| `RELAY_MODE` | `cloudflare` |
| `NEXT_PUBLIC_API_ORIGIN` | `https://relay-private-api.<tai-khoan>.workers.dev` hoặc origin HTTPS custom domain |

Redeploy sau khi đổi origin. Không cần `ACCESS_PASSWORD`, `AUTH_SECRET`, `HOME_BACKEND_KEY` hoặc `HOME_BACKEND_URL` trên Vercel. Các endpoint `/api/*` trên Vercel bị tắt trong chế độ này; không có fallback proxy media qua Vercel.

### 3. Kiểm tra deployment thật

Mở frontend, nhập mật khẩu, bấm **Kiểm tra backend Cloudflare**, thử một video công khai ngắn. Trong Network:

- Auth, metadata, thumbnail và stream gọi domain **Worker**, không phải Vercel.
- Preflight `OPTIONS` trả 204; stream trả 206 và có `Content-Range`.
- Không có request trực tiếp từ browser tới YouTube/googlevideo.
- Nếu gặp CORS, kiểm tra `FRONTEND_ORIGINS` khớp chính xác origin frontend và `NEXT_PUBLIC_API_ORIGIN` đúng origin Worker.
- Nếu gặp `UPSTREAM_BLOCKED`, YouTube có thể từ chối IP Cloudflare. Việc chuyển hosting không đảm bảo hết chặn; URL media còn có thể gắn IP, trong khi Workers không bảo đảm cùng IP đầu ra cho mọi request.

### Phiên và bảo mật ở chế độ backend trực tiếp

Các nguyên tắc dưới đây áp dụng cho cả Oracle `server` và Cloudflare `worker`:

- Token phiên AES-GCM tối đa 8 giờ, gửi bằng header `Authorization: Bearer`. Chỉ giữ trong bộ nhớ của tab, **không lưu localStorage/sessionStorage, cookie hoặc URL**. Tải lại trang/mở tab mới cần mở khóa lại. Không phụ thuộc third-party cookie giữa frontend và API.
- DASH thêm bearer header cho request đến API origin đã cấu hình. Thumbnail tải bằng fetch có xác thực, rồi hiển thị blob URL. Browser không đọc URL từ lịch sử để fetch tùy ý.
- CORS chỉ cho origin đã cấu hình; CSP frontend chỉ mở thêm `connect-src` cho API origin đó. **CORS không thay thế xác thực**: non-browser có thể giả Origin, nhưng vẫn phải có mật khẩu/token.
- Ticket media vẫn được mã hóa, ràng buộc phiên, hết hạn tối đa 2 giờ; không nhận URL nguồn tùy ý. Request stream tối đa 4 MiB và mọi redirect upstream đều phải qua allowlist.
- Nút **Khóa** xóa token khỏi bộ nhớ, hủy request và dừng player, kể cả khi offline. Phiên stateless không thu hồi bản sao token đã bị đánh cắp; đổi mật khẩu/`AUTH_SECRET` trên backend để vô hiệu hóa toàn bộ.
- Oracle dùng rate limiter trong một Node process; Cloudflare còn có binding `LOGIN_RATE_LIMITER`. Đây là bảo vệ cơ bản, không phải quota toàn cục. Không challenge CAPTCHA cho `/api/stream` vì trình phát gửi byte-range tự động.
- Không bật access log chứa query string nếu chưa che ticket media. Nếu bật logs/tail, xử lý dữ liệu nhạy cảm và thời hạn lưu phù hợp; không log bearer token, ticket hoặc URL upstream.

### Chạy hai phần local

```bash
npm ci
cp .dev.vars.example .dev.vars
# Điền ACCESS_PASSWORD và AUTH_SECRET (ít nhất 32 ký tự) trong .dev.vars.
# Terminal 1:
npm run dev:worker
# Terminal 2:
npm run dev:cloudflare
```

Mở `http://127.0.0.1:3000` (localhost cũng được cho phép mặc định). Frontend gọi trực tiếp `http://127.0.0.1:8787`. `dev:cloudflare` ép chế độ Cloudflare local, không sửa/ghi đè `.env.local` hiện có. Muốn dùng API khác, truyền `NEXT_PUBLIC_API_ORIGIN=https://... npm run dev:cloudflare`. `.dev.vars` chỉ dành cho local và đã được gitignore; secrets production phải đặt riêng trên Cloudflare.

## Các chế độ khác (giữ tương thích)

| `RELAY_MODE` | Chức năng |
| --- | --- |
| `vps` | Next.js/Vercel chỉ UI; browser gọi Oracle/VPS trực tiếp |
| `server` | API Node.js trên Oracle/VPS, chạy sau Caddy |
| `cloudflare` | Next.js/Vercel chỉ UI; browser gọi Worker trực tiếp |
| `worker` | API Cloudflare, được cấu hình sẵn trong Wrangler |
| `standalone` | Next.js UI + API cùng origin (mặc định, chạy local/Vercel) |
| `frontend` | Next.js/Vercel xác thực rồi proxy đến backend nhà; media vẫn qua Vercel |
| `home` | Backend nhà chỉ nhận khóa riêng từ frontend |

Không chạy Next.js với `RELAY_MODE=worker`; chế độ đó dành cho entrypoint Wrangler. Chạy Oracle bằng `npm run build:server` và `npm run start:server`. Backend nhà cũ vẫn dùng `npm run setup:home`, `npm run dev:home` và `HOME_BACKEND_URL`/`HOME_BACKEND_KEY` theo `.env.example`.

## Chạy local standalone

Dùng Node.js 24 LTS:

```bash
npm ci
npm run setup
npm run dev
```

Mở `http://localhost:3000`. `setup` tạo `.env.local` bằng khóa ngẫu nhiên và in mật khẩu local. Script **không ghi đè** nếu file đã tồn tại.

Hoặc copy `.env.example` thành `.env.local` và điền:

| Biến server | Yêu cầu |
| --- | --- |
| `ACCESS_PASSWORD` | Mật khẩu không rỗng, không yêu cầu tối thiểu 16 ký tự |
| `AUTH_SECRET` | Khóa riêng ít nhất 32 ký tự; tạo bằng `openssl rand -hex 32` |

Không đặt các biến trên dưới dạng `NEXT_PUBLIC_*`. Không commit `.env.local`. Khi mật khẩu trống hoặc `AUTH_SECRET` thiếu / quá ngắn, API từ chối truy cập (503); không có mật khẩu mặc định và không tự mở proxy. Mật khẩu 1–3 ký tự cũng được chấp nhận, nhưng dễ bị đoán; nên dùng mật khẩu dài, ngẫu nhiên khi đưa site lên Vercel.

## Deploy standalone hoàn toàn trên Vercel

Phần này chỉ dành cho `RELAY_MODE=standalone`, **không áp dụng** cho frontend Oracle/Cloudflare ở trên.

1. Tạo Git repository, push code (không bao gồm `.env.local`).
2. Trong Vercel chọn **Add New → Project**, import repository.
3. Framework: **Next.js**; Node.js: **24.x**; Build: `npm run build`.
4. Thêm `ACCESS_PASSWORD` và `AUTH_SECRET` vào **Settings → Environment Variables**, ít nhất cho Production. Nếu dùng Preview, cấu hình môi trường đó riêng.
5. Bật **Fluid Compute** để hỗ trợ thời gian chạy đã cấu hình: `/api/video` tối đa 120 giây, `/api/stream` tối đa 60 giây. Vercel plan / cấu hình runtime có thể áp dụng giới hạn khác; kiểm tra dashboard và [duration docs](https://vercel.com/docs/functions/configuring-functions/duration).
6. Deploy, mở domain, nhập mật khẩu và thử một video công khai ngắn. Nếu server trả `UPSTREAM_BLOCKED`, giao diện sẽ báo rõ: YouTube có thể từ chối IP Vercel, không có cách đảm bảo sửa bằng frontend.

**Không có credential Vercel trong project; code không tự tạo deployment.** Bạn cũng có thể dùng Vercel CLI sau khi tự đăng nhập: `npx vercel` rồi `npx vercel --prod`.

### Trước khi để domain hoạt động lâu dài

- Trong **Firewall**, cấu hình rate limiting / managed protection cho `/api/auth`, `/api/video`, `/api/stream` phù hợp tính năng plan. Không challenge CAPTCHA trên stream vì trình phát cần request byte-range tự động.
- Có bộ đếm chống spam trong process, nhưng **không phải rate limiter phân tán**: Vercel có nhiều instance và cold start sẽ làm mất bộ đếm. Không coi nó là quota / bảo vệ brute-force toàn cục. Nên dùng mật khẩu ngẫu nhiên dài khi deploy công khai.
- Theo dõi **Usage**, Fast Data Transfer, Fast Origin Transfer, Function Duration; cấu hình cảnh báo / spend management nếu plan hỗ trợ. Video có thể tốn băng thông đáng kể. Khóa truy cập không giới hạn chi phí của một phiên hợp lệ.
- Đừng chia sẻ mật khẩu, cookie phiên hoặc URL ticket. Không dùng như dịch vụ proxy công khai.

## Cách hoạt động của core

Sơ đồ dưới đây là chế độ standalone. Với Oracle hoặc Cloudflare, browser gọi các API cùng tên trên API origin riêng; mã xử lý media dùng chung.

```text
Browser -- cùng origin --> Next.js trên Vercel -- server request --> YouTube / googlevideo
            /api/video        metadata + DASH MPD
            /api/stream       byte-range audio/video
            /api/thumbnail    ảnh từ i.ytimg.com
```

- `youtubei.js` dùng client IOS để lấy thông tin video và các format MP4 có URL đọc trực tiếp (client WEB hiện có thể chỉ trả descriptor SABR). Đây vẫn là API không chính thức, không đảm bảo client tiếp tục hoạt động. QuickJS chạy phần mã decipher trong WASM, không dùng `eval`, `new Function` hay `node:vm` để chạy mã player trong runtime host. Worker dùng WASM import sẵn và có instruction budget vì clock Workers không tiến trong mã đồng bộ.
- DASH (`dashjs`, chỉ tải ở browser khi có video) ghép H.264 video và AAC audio; có tua và điều khiển phát native. Không nhúng iframe YouTube. Font tải từ frontend; thumbnail, manifest và media tải qua backend (cùng origin ở standalone, origin Worker ở Cloudflare), không gọi trực tiếp YouTube từ browser.
- Endpoint video kiểm tra trước một byte của luồng audio và video thấp nhất. Điều này không đảm bảo toàn bộ video phát thành công, nhưng không báo thành công khi upstream đã từ chối ngay từ đầu.
- Mỗi request stream chỉ đọc một range, tối đa **4 MiB**. Không buffer toàn bộ video, không mở một function kéo dài bằng độ dài video. Segment lớn hơn giới hạn bị từ chối, không cắt bớt làm hỏng segment. Chọn 360p / chỉ nghe nếu gặp `SEGMENT_TOO_LARGE`.
- URL nguồn được mã hóa AES-256-GCM trong ticket có thời hạn tối đa 2 giờ, ràng buộc vào phiên 8 giờ và thời hạn URL YouTube. Sau khi hết hạn, bấm **Lấy lại luồng**; trình phát cố tiếp tục ở vị trí trước đó.
- Stream không nhận URL tùy ý, chỉ nhận ticket do server phát hành. Chỉ cho phép HTTPS `/videoplayback` trên subdomain `.googlevideo.com`; kiểm tra lại mọi redirect trước khi fetch. Không chuyển tiếp cookie / mật khẩu người dùng tới upstream.
- Standalone dùng cookie HttpOnly, SameSite=Strict, Secure trên production; Oracle/Cloudflare trực tiếp dùng bearer token trong bộ nhớ. Có kiểm tra Origin. CSP dùng nonce và chỉ cho kết nối đến frontend/backend đã cấu hình.
- API media không cache công khai. Ảnh thumbnail chỉ cache private trên browser. Đổi `ACCESS_PASSWORD` hoặc `AUTH_SECRET` sẽ vô hiệu hóa tất cả phiên và ticket cũ.
- Nút Khóa xóa cookie (standalone) hoặc token trong bộ nhớ (Oracle/Cloudflare), và dừng player tại browser. Phiên stateless: bản sao token/cookie bị đánh cắp vẫn có hiệu lực đến hết hạn; muốn vô hiệu hóa toàn bộ thì đổi khóa/mật khẩu ở backend.
- Lịch sử tối đa 12 video chỉ lưu ở `localStorage`, **không mã hóa**. Người dùng cùng profile browser có thể đọc nó; bấm xóa lịch sử trước khi dùng máy chia sẻ. Không lưu mật khẩu, cookie hay ticket trong lịch sử.

## Giới hạn thực tế

- **IP datacenter:** YouTube có thể chặn Oracle/Vercel/Cloudflare hoặc yêu cầu xác minh. URL media đôi khi gắn với IP; các môi trường serverless có thể có IP đầu ra khác nhau giữa lần resolve và lúc đọc đoạn. Có thể chạy local nhưng không chạy trên deployment.
- **YouTube thay đổi:** InnerTube là API không chính thức. Thay đổi client, chữ ký, Proof of Origin / SABR có thể làm hết format phù hợp hoặc không đọc được stream. Cần cập nhật `youtubei.js`; không có fallback bảo đảm.
- Không nhận cookie YouTube, tài khoản Google hoặc Proof-of-Origin token từ người dùng; không giải DRM, không hỗ trợ video private, membership / trả phí, yêu cầu đăng nhập / giới hạn tuổi hay livestream.
- Cần browser hỗ trợ MediaSource, H.264 / AAC và DASH, ưu tiên Chrome / Edge / Firefox mới. Một số Safari / iOS không hỗ trợ cách phát này.
- Chỉ phát một video từ link watch, Shorts, embed, `youtu.be`, music.youtube.com hoặc ID; không có tìm kiếm / tải playlist, không proxy nguyên website YouTube.
- Không có subtitle ở bản đầu tiên. Control phát là native; mức hỗ trợ có thể khác theo browser.
- Vercel không phải media server. Chia segment giúp tránh response quá lớn / function quá dài nhưng không loại bỏ giới hạn, băng thông, chi phí hay chính sách nhà cung cấp. Kiểm tra [function limits](https://vercel.com/docs/functions/limitations) trước khi dùng lâu dài.

## Kiểm tra

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:worker
npx playwright install chromium
npm run test:e2e
npm run test:cloudflare
```

Unit tests kiểm tra parsing link, token / hạn sử dụng / ràng buộc phiên, range, origin / body, redirect allowlist, giới hạn dữ liệu và API authentication. E2E chạy desktop / mobile: mở khóa, lỗi upstream, lịch sử, layout, chặn request trực tiếp ra YouTube.

`npm test` còn kiểm tra bundle thật trong workerd/Miniflare: Node crypto, platform Cloudflare của SDK, QuickJS WASM, sandbox/instruction budget, CORS/preflight, bearer auth, range và không chuyển credential lên upstream. `test:cloudflare` chạy FE và Worker trên hai origin khác nhau, kiểm tra header DASH, thumbnail blob, không lưu token, reload và khóa offline trên desktop/mobile. Dữ liệu upstream là fixture **không phát được**, chỉ dùng kiểm tra transport; không coi đây là chứng minh YouTube phát được trên Cloudflare. Entry point test không nằm trong bundle production.

E2E dùng biến môi trường dành riêng cho test, audit accessibility cơ bản và mock API video cho các trạng thái lỗi; không xem việc đó là kiểm chứng phát thật trên Vercel. Có smoke test upstream thật riêng: `RUN_LIVE_SMOKE=1 npx playwright test e2e/live.spec.ts --project=desktop` (phát, tua và chuyển chế độ chỉ nghe; phụ thuộc mạng). Muốn kiểm tra upstream thực tế, chạy app với `.env.local`, dán video công khai và xem Network: `/api/video` phải thành công, `/api/stream` trả 206, audio / video phát và tua được. Luôn cần thử lại trên deployment thật.

## Các file chính

- `components/workspace.tsx`, `app/globals.css`: UI, khóa phiên, form và lịch sử.
- `components/dash-player.tsx`: DASH player phía client.
- `lib/youtube.ts`, `lib/evaluator.ts`: resolve format và decipher.
- `lib/auth.ts`, `lib/media.ts`, `lib/range.ts`: phiên, capability, allowlist và byte range.
- `app/api/*/route.ts`: route handler dùng chung cho Next.js standalone/home/server và Worker; API Vercel bị tắt ở chế độ `vps`/`cloudflare`.
- `deploy/oracle/*`, `scripts/setup-server.mjs`: Caddy, systemd và thiết lập backend Oracle/VPS.
- `cloudflare/index.ts`, `cloudflare/evaluator.ts`, `wrangler.jsonc`: entrypoint API, CORS, platform rate limiter, WASM loader và deploy Cloudflare.
- `lib/api-client.ts`, `components/private-thumbnail.tsx`: gọi API trực tiếp, bearer token trong bộ nhớ và ảnh có xác thực.
- `proxy.ts`, `next.config.ts`: CSP, header bảo mật và WASM file tracing.
