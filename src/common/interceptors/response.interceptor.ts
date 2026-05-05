import {
    type CallHandler,
    type ExecutionContext,
    Injectable,
    type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

export interface ResponseEnvelope<T> {
    statusCode: number;
    data: T;
    meta?: Record<string, unknown>;
}

type ExtractData<T> = T extends { data: infer D; page: number } ? D : T;

@Injectable()
export class ResponseInterceptor<T>
    implements NestInterceptor<T, ResponseEnvelope<ExtractData<T>>>
{
    intercept(
        context: ExecutionContext,
        next: CallHandler<T>,
    ): Observable<ResponseEnvelope<ExtractData<T>>> {
        return next.handle().pipe(
            map((result) => {
                const statusCode = context
                    .switchToHttp()
                    .getResponse().statusCode;

                // Detect paginated structural responses to prevent data.data antipattern
                if (
                    result &&
                    typeof result === "object" &&
                    "data" in result &&
                    "page" in result
                ) {
                    const { data, ...meta } = result as unknown as {
                        data: ExtractData<T>;
                        [key: string]: unknown;
                    };
                    return {
                        statusCode,
                        data,
                        meta: meta as Record<string, unknown>,
                    };
                }

                return {
                    statusCode,
                    data: result as ExtractData<T>,
                };
            }),
        );
    }
}
