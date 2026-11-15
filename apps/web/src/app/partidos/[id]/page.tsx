import { redirect } from 'next/navigation';

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/apuestas?matchId=${encodeURIComponent(id)}`);
}
