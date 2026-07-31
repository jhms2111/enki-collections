import { DemoExperience } from "@/modules/demo-ui/demo-experience";

export default async function DemoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <DemoExperience slug={slug} />;
}
