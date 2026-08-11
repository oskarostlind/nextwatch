// app/group/swipe/loading.tsx
//
// Samma kortskelett som solo-swipen (app/swipe/loading.tsx). Skelettet har
// kortets geometri (aspect-[2/3], max-w-[420px], rounded-2xl), så övergången
// skelett → poster blir en ren korsning utan hopp i layouten.
import { PageSkeleton } from "@/app/components/ui/Skeletons";

export default function Loading() {
  return <PageSkeleton variant="card" />;
}
