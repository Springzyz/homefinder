import { SearchForm } from "@/components/SearchForm";

export default async function NewSearch({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">New search</h1>
      <SearchForm error={!!(await searchParams).error} />
    </>
  );
}
