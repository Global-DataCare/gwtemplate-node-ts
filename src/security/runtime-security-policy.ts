/** Demo is an explicit local profile, never a synonym for Test Network. */
export function isLocalDemoSecurityMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const deployment = [env.NODE_ENV, env.DEPLOYMENT_ENV].map(value => String(value || '').toLowerCase());
  return env.SECURITY_MODE === 'demo'
    && String(env.NETWORK_MODE || 'test').toLowerCase() === 'test'
    && !deployment.some(value => ['production', 'prod', 'staging'].includes(value));
}

export function allowsInsecureDemoBearer(env: NodeJS.ProcessEnv = process.env): boolean {
  return isLocalDemoSecurityMode(env) && /^(true|1|yes|enabled)$/i.test(String(env.DEMO_ALLOW_INSECURE_BEARER || ''));
}
