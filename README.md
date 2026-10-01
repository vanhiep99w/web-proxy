# relay — trình phát YouTube riêng trên Vercel

Ứng dụng Next.js / TypeScript dành cho **một người**, giao diện tối bằng tiếng Việt. Dán link YouTube để xem video tối đa 360p / 720p hoặc chỉ nghe. Có khóa truy cập và lịch sử lưu trên trình duyệt.

**Đây là bản thử nghiệm, không phải cam kết vượt mọi chặn mạng.** Chỉ sử dụng nội dung bạn có quyền truy cập, theo chính sách mạng và điều khoản YouTube / Vercel. Không hỗ trợ Spotify ở bản này.

## Chạy local

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

## Deploy Vercel

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

## Cách hoạt động

```text
Browser -- cùng origin --> Next.js trên Vercel -- server request --> YouTube / googlevideo
            /api/video        metadata + DASH MPD
            /api/stream       byte-range audio/video
            /api/thumbnail    ảnh từ i.ytimg.com
```

- `youtubei.js` dùng client IOS để lấy thông tin video và các format MP4 có URL đọc trực tiếp (client WEB hiện có thể chỉ trả descriptor SABR). Đây vẫn là API không chính thức, không đảm bảo client tiếp tục hoạt động. QuickJS chạy phần mã decipher trong WASM, không dùng `eval`, `new Function` hay `node:vm` để chạy mã player trong process Node.
- DASH (`dashjs`, chỉ tải ở browser khi có video) ghép H.264 video và AAC audio; có tua và điều khiển phát native. Không nhúng iframe YouTube. Font, ảnh thumbnail, manifest và media đều được tải qua origin của website, không gọi trực tiếp YouTube từ browser.
- Endpoint video kiểm tra trước một byte của luồng audio và video thấp nhất. Điều này không đảm bảo toàn bộ video phát thành công, nhưng không báo thành công khi upstream đã từ chối ngay từ đầu.
- Mỗi request stream chỉ đọc một range, tối đa **4 MiB**. Không buffer toàn bộ video, không mở một function kéo dài bằng độ dài video. Segment lớn hơn giới hạn bị từ chối, không cắt bớt làm hỏng segment. Chọn 360p / chỉ nghe nếu gặp `SEGMENT_TOO_LARGE`.
- URL nguồn được mã hóa AES-256-GCM trong ticket có thời hạn tối đa 2 giờ, ràng buộc vào phiên 8 giờ và thời hạn URL YouTube. Sau khi hết hạn, bấm **Lấy lại luồng**; trình phát cố tiếp tục ở vị trí trước đó.
- Stream không nhận URL tùy ý, chỉ nhận ticket do server phát hành. Chỉ cho phép HTTPS `/videoplayback` trên subdomain `.googlevideo.com`; kiểm tra lại mọi redirect trước khi fetch. Không chuyển tiếp cookie / mật khẩu người dùng tới upstream.
- Cookie HttpOnly, SameSite=Strict, Secure trên production. POST / DELETE có kiểm tra Origin. CSP dùng nonce và hạn chế browser kết nối ra ngoài origin.
- API media không cache công khai. Ảnh thumbnail chỉ cache private trên browser. Đổi `ACCESS_PASSWORD` hoặc `AUTH_SECRET` sẽ vô hiệu hóa tất cả phiên và ticket cũ.
- Nút Khóa xóa cookie và dừng player tại browser. Phiên là stateless: bản sao cookie bị đánh cắp vẫn có hiệu lực đến hết hạn; muốn vô hiệu hóa toàn bộ thì đổi khóa / mật khẩu và redeploy.
- Lịch sử tối đa 12 video chỉ lưu ở `localStorage`, **không mã hóa**. Người dùng cùng profile browser có thể đọc nó; bấm xóa lịch sử trước khi dùng máy chia sẻ. Không lưu mật khẩu, cookie hay ticket trong lịch sử.

## Giới hạn thực tế

- **IP datacenter:** YouTube có thể chặn Vercel hoặc yêu cầu xác minh. URL media đôi khi gắn với IP; các function Vercel có thể có IP đầu ra khác nhau giữa lần resolve và lúc đọc đoạn. Có thể chạy local nhưng không chạy trên Vercel.
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
npx playwright install chromium
npm run test:e2e
```

Unit tests kiểm tra parsing link, token / hạn sử dụng / ràng buộc phiên, range, origin / body, redirect allowlist, giới hạn dữ liệu và API authentication. E2E chạy desktop / mobile: mở khóa, lỗi upstream, lịch sử, layout, chặn request trực tiếp ra YouTube.

E2E dùng biến môi trường dành riêng cho test, audit accessibility cơ bản và mock API video cho các trạng thái lỗi; không xem việc đó là kiểm chứng phát thật trên Vercel. Có smoke test upstream thật riêng: `RUN_LIVE_SMOKE=1 npx playwright test e2e/live.spec.ts --project=desktop` (phát, tua và chuyển chế độ chỉ nghe; phụ thuộc mạng). Muốn kiểm tra upstream thực tế, chạy app với `.env.local`, dán video công khai và xem Network: `/api/video` phải thành công, `/api/stream` trả 206, audio / video phát và tua được. Luôn cần thử lại trên deployment thật.

## Các file chính

- `components/workspace.tsx`, `app/globals.css`: UI, khóa phiên, form và lịch sử.
- `components/dash-player.tsx`: DASH player phía client.
- `lib/youtube.ts`, `lib/evaluator.ts`: resolve format và decipher.
- `lib/auth.ts`, `lib/media.ts`, `lib/range.ts`: phiên, capability, allowlist và byte range.
- `app/api/*/route.ts`: API Node.js cho Vercel.
- `proxy.ts`, `next.config.ts`: CSP, header bảo mật và WASM file tracing.
