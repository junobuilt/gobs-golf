import EditModeBanner from "@/components/round/EditModeBanner";

// Wraps every round-scoped page (/round/[id]/summary, /round/[id]/scorecard,
// future round-scoped pages) so the admin edit-mode banner pins at the top
// consistently across navigation. Banner self-gates on ?admin=1&edit=1.

export default function RoundLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <EditModeBanner />
      {children}
    </>
  );
}
