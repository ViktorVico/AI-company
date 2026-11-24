import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-[380px] animate-rise">
        <h1 className="display text-[44px]">
          0 employees.
          <br />
          <span className="text-faint">36 AI agents.</span>
        </h1>
        <p className="mt-4 text-[14px] text-muted">Sign in to run your company.</p>
        <LoginForm next={next ?? "/"} />
      </div>
    </div>
  );
}
