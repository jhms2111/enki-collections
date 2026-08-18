import { redirect } from "next/navigation";

export default async function DemoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/demo/${encodeURIComponent(slug)}/chat`);
}
