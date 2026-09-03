import { NextRequest, NextResponse } from "next/server";
import { checkSupportedChainsNativeBalances } from "../../../../lib/nativeFundsGuard";

export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
    if (process.env.NODE_ENV === "development") return true;
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return true;
    return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

function madridHour(now = new Date()): number {
    const hour = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Madrid",
        hour: "numeric",
        hourCycle: "h23",
    }).formatToParts(now).find((part) => part.type === "hour")?.value;
    return Number(hour);
}

function isVercelCron(request: NextRequest): boolean {
    return (request.headers.get("user-agent") ?? "").startsWith("vercel-cron");
}

export async function GET(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const forced = request.nextUrl.searchParams.get("force") === "1";
    if (isVercelCron(request) && !forced && madridHour() !== 8) {
        return NextResponse.json({
            ok: true,
            skipped: true,
            reason: "not_08_europe_madrid",
            madridHour: madridHour(),
        });
    }

    const { results, alerted } = await checkSupportedChainsNativeBalances();
    return NextResponse.json({ ok: true, alerted, results });
}
