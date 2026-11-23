import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { Logo } from "@/components/logo";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={44} className="mx-auto" />
          <h1 className="mt-5 font-display text-4xl">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted">{APP_TAGLINE}</p>
        </div>
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
