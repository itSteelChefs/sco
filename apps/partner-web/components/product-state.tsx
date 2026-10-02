export function LoadingState() { return <p role="status">جارٍ التحميل...</p>; }
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <section role="alert"><p>{message}</p>{onRetry && <button type="button" onClick={onRetry}>إعادة المحاولة</button>}</section>;
}
export function EmptyState({ message }: { message: string }) { return <p>{message}</p>; }