import "./globals.css";
import { MuiThemeProvider } from "@/components/MuiThemeProvider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
        <body className="min-h-screen text-slate-100 antialiased">
        <MuiThemeProvider>{children}</MuiThemeProvider>
        </body>
        </html>
    );
}
