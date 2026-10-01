"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="fatal-page"><span className="eyebrow">RELAY / CÓ LỖI</span><h1>Chưa mở được trang.</h1><p>Thử tải lại. Nếu vẫn lỗi, kiểm tra cấu hình server.</p><button className="primary-button" onClick={reset}>Thử lại</button></main>;
}
