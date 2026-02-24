/** biome-ignore-all lint/suspicious/noExplicitAny: any format data */

import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(
            map((result) => {
                const statusCode = context.switchToHttp().getResponse().statusCode;

                // Detect paginated structural responses to prevent data.data antipattern
                if (result && typeof result === "object" && "data" in result && "page" in result) {
                    const { data, ...meta } = result;
                    return {
                        statusCode,
                        data,
                        meta,
                    };
                }

                return {
                    statusCode,
                    data: result,
                };
            }),
        );
    }
}
