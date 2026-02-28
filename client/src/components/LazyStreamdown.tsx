import { lazy, Suspense } from "react";

const StreamdownInner = lazy(() =>
  import("streamdown").then((mod) => ({ default: mod.Streamdown }))
);

export function LazyStreamdown({ children }: { children: string }) {
  return (
    <Suspense fallback={<span>{children}</span>}>
      <StreamdownInner>{children}</StreamdownInner>
    </Suspense>
  );
}
