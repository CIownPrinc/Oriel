import { PageSkeleton } from "@/components/ui/Skeleton";

/** Every app page loads in its own shape: a title, a sentence, rows. Nothing jumps when it arrives. */
export default function Loading() {
  return <PageSkeleton />;
}
