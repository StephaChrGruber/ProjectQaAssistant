import NextAuth from "next-auth"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"

const { handlers } = NextAuth({
    providers: [
        MicrosoftEntraID({
            clientId: process.env.ENTRA_CLIENT_ID!,
            clientSecret: process.env.ENTRA_CLIENT_SECRET!,
            issuer: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0`,
        }),
    ],
    session: { strategy: "jwt" },
    callbacks: {
        async jwt({ token, account, profile }) {
            // Keep the access token for backend calls
            if (account?.access_token) (token as any).access_token = account.access_token
            token.email = profile?.email ?? token.email
            token.name = profile?.name ?? token.name
            return token
        },
        async session({ session, token }) {
            (session as any).access_token = (token as any).access_token
            return session
        },
    },
})

export const { GET, POST } = handlers
