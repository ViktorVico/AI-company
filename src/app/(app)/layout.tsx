import { Shell } from "@/components/shell";
import { LiveProvider } from "@/components/live";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveProvider>
      <Shell>{children}</Shell>
    </LiveProvider>
  );
}
