import { notFound } from "next/navigation";
import { SearchForm } from "@/components/SearchForm";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EditSearch({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [s] = await q("select * from searches where id=$1", [id]);
  if (!s) notFound();
  s.id = Number(s.id);
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Edit search</h1>
      <SearchForm search={s} error={!!(await searchParams).error} />
    </>
  );
}
