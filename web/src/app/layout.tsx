import "./globals.css";
import { AppProviders } from "@/components/AppProviders";

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
        <body className="min-h-screen text-slate-100 antialiased">
        <AppProviders>{children}</AppProviders>
        </body>
        </html>
    );
}
