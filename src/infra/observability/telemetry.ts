/**
 * OpenTelemetry Configuration
 * 
 * Configures distributed tracing for OpenClaw multi-tenant deployment.
 * Exports traces to Jaeger for visualization and debugging.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

export interface TelemetryConfig {
    serviceName: string;
    serviceVersion: string;
    jaegerEndpoint?: string;
    enabled?: boolean;
}

let sdkInstance: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK
 */
export function initializeTelemetry(config: TelemetryConfig): NodeSDK {
    if (sdkInstance) {
        console.warn('Telemetry already initialized');
        return sdkInstance;
    }

    if (!config.enabled) {
        console.log('Telemetry disabled');
        return null as any;
    }

    // Configure Jaeger exporter
    const jaegerExporter = new JaegerExporter({
        endpoint: config.jaegerEndpoint || 'http://localhost:14268/api/traces',
    });

    // Configure resource attributes
    const resource = new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
            process.env.NODE_ENV || 'development',
    });

    // Initialize SDK
    const sdk = new NodeSDK({
        resource,
        spanProcessor: new BatchSpanProcessor(jaegerExporter),
        instrumentations: [
            getNodeAutoInstrumentations({
                // Disable instrumentations we don't need
                '@opentelemetry/instrumentation-fs': {
                    enabled: false,
                },
            }),
        ],
    });

    sdk.start();
    console.log('OpenTelemetry initialized');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        try {
            await sdk.shutdown();
            console.log('OpenTelemetry shut down successfully');
        } catch (error) {
            console.error('Error shutting down OpenTelemetry:', error);
        }
    });

    sdkInstance = sdk;
    return sdk;
}

/**
 * Get telemetry configuration from environment
 */
export function getTelemetryConfigFromEnv(): TelemetryConfig {
    return {
        serviceName: process.env.OTEL_SERVICE_NAME || 'openclaw-gateway',
        serviceVersion: process.env.npm_package_version || '1.0.0',
        jaegerEndpoint: process.env.JAEGER_ENDPOINT,
        enabled: process.env.OTEL_ENABLED === 'true',
    };
}

/**
 * Shutdown telemetry
 */
export async function shutdownTelemetry(): Promise<void> {
    if (sdkInstance) {
        await sdkInstance.shutdown();
        sdkInstance = null;
    }
}
