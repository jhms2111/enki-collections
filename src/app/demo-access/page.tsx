import { DemoAccessForm } from "@/modules/demo-ui/demo-access-form";

export default async function DemoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  return <DemoAccessForm returnTo={returnTo ?? "/demo/jf-demo"} />;
}
