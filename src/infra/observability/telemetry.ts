/**
 * OpenTelemetry Setup
 * Configures distributed tracing for OpenClaw Enterprise
 * 
 * Note: Telemetry is optional and can be disabled via OTEL_ENABLED=false
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const JAEGER_ENDPOINT = process.env.JAEGER_ENDPOINT || 'http://localhost:4318/v1/traces';
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'openclaw-gateway';
const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

/**
 * Initialize OpenTelemetry SDK
 */
export function initializeTelemetry(): NodeSDK | null {
    if (!OTEL_ENABLED) {
        console.log('OpenTelemetry disabled');
        return null;
    }

    try {
        // Create resource with service metadata
        const resource = Resource.default().merge(
            new Resource({
                [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
                [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
            })
        );

        const sdk = new NodeSDK({
            resource: resource as any, // Type cast to avoid version mismatch
            traceExporter: new OTLPTraceExporter({
                url: JAEGER_ENDPOINT,
            }),
            instrumentations: [
                getNodeAutoInstrumentations({
                    // Disable problematic instrumentations
                    '@opentelemetry/instrumentation-fs': {
                        enabled: false,
                    },
                } as any),
            ],
        });

        sdk.start();
        console.log('OpenTelemetry initialized');

        // Graceful shutdown
        process.on('SIGTERM', () => {
            sdk
                .shutdown()
                .then(() => console.log('Tracing terminated'))
                .catch((error: any) => console.error('Error terminating tracing', error))
                .finally(() => process.exit(0));
        });

        return sdk;
    } catch (error) {
        console.error('Failed to initialize OpenTelemetry:', error);
        return null;
    }
}

export default initializeTelemetry;
