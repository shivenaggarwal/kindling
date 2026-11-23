import { APP_TAGLINE } from "@/lib/config";
import { Logo, Wordmark } from "@/components/logo";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-[360px]">
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo size={64} boot />
          <Wordmark className="mt-7 text-[40px]" />
          <p className="mt-3 text-[15px] text-muted">{APP_TAGLINE}</p>
        </div>
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
