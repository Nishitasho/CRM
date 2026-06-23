"use client";

import { useEffect } from "react";

export default function DailyMetricsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Daily metrics page failed", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl">
      <section className="card p-6">
        <p className="text-sm font-bold text-red-700">
          日次実績画面を読み込めませんでした。
          <br />
          データベース更新状況を確認してください。
        </p>
        <button className="primary-button mt-5" type="button" onClick={reset}>
          再試行
        </button>
      </section>
    </div>
  );
}
