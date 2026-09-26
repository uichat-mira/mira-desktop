import Skeleton from "@/shared/ui/Skeleton";

export default function DevelopmentPageSkeleton() {
  return (
    <div
      aria-busy="true"
      data-testid="development-page-skeleton"
      className="flex h-full min-h-0 flex-col gap-4"
    >
      <Skeleton height={20} width="28%" />
      <Skeleton.Text lines={4} lastLineWidth="72%" />
      <Skeleton height={40} width={160} />
    </div>
  );
}
