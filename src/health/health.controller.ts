import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

// Liveness probes (LB / k8s / uptime monitors) poll this endpoint at
// fixed intervals from a small set of IPs. Skipping the global throttler
// avoids self-DoS where a tight probe cadence trips the per-IP limit.
@SkipThrottle()
@Controller("health")
export class HealthController {
    @Get()
    check(): { status: string } {
        return { status: "ok" };
    }
}
