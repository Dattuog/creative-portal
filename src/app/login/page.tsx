import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { LoginForm } from "./LoginForm";
import { Mark } from "@/components/shell/Mark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  if (!env.useSupabase()) redirect("/"); // sample mode uses the "Viewing as" switcher
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Mark size={28} />
          <CardTitle className="pt-2 text-lg">Sign in to Lumen Skin</CardTitle>
          <CardDescription>Accounts are created by an admin.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
