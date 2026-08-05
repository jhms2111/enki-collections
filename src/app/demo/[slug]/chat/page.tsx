import { DeterministicWebchat } from "@/modules/webchat/deterministic-webchat";

export default async function WebchatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <DeterministicWebchat
      slug={slug}
      version={process.env.DEMO_VERSION ?? "local"}
    />
  );
}
