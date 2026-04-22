export const dynamic = "force-dynamic";

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-6xl font-bold text-gray-700">404</h1>
      <p className="mt-4 text-gray-400">Page not found</p>
      <Link href="/" className="mt-6 text-indigo-400 hover:text-indigo-300 text-sm underline">
        Back to home
      </Link>
    </main>
  );
}
