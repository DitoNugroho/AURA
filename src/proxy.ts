import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/preview" || path.startsWith("/preview/") || path === "/login" || path.startsWith("/_next/") || path.startsWith("/api/")) {
    const response = NextResponse.next(); response.headers.set("Cache-Control", "no-store, must-revalidate"); return response;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.redirect(new URL("/login", request.url));

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (path === "/") return NextResponse.redirect(new URL(user ? "/dashboard" : "/login", request.url));
  if (!user && path !== "/login") return NextResponse.redirect(new URL("/login", request.url));
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
