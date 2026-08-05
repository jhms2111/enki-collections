import { DemoExperience } from "@/modules/demo-ui/demo-experience";

export default async function DemoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <>
      <a className="chat-entry" href={`/demo/${encodeURIComponent(slug)}/chat`}>
        Abrir webchat demonstrativo
      </a>
      <DemoExperience slug={slug} version={process.env.DEMO_VERSION ?? "local"} />
    </>
  );
}
