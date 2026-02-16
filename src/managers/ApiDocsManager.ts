// src/managers/ApiDocsManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export function createApiDocsSetupOptions(swaggerSpecUrl = '/swagger-spec.json'): any {
  const globalContextScript = `
    (() => {
      const KEY_PREFIX = 'gw-api-docs:';
      const fields = [
        { key: 'testId', label: 'test id', placeholder: '01' },
        { key: 'tenantId', label: 'tenantId', placeholder: 'acme' },
        { key: 'taxId', label: 'tax id', placeholder: 'default: TaxNumber-<tenantId>, e.g. TaxNumber-acme' },
        { key: 'jurisdiction', label: 'jurisdiction', placeholder: 'ES' },
        { key: 'sector', label: 'sector', placeholder: 'health-care' },
        { key: 'hostSector', label: 'network type', placeholder: 'test' },
        { key: 'offerId', label: 'offerId', placeholder: 'urn:...:Offer:...' },
        { key: 'activationCode', label: 'activationCode', placeholder: 'lic-...' },
        { key: 'licenseId', label: 'licenseId', placeholder: 'lic-...' },
      ];

      function getValue(key) { return localStorage.getItem(KEY_PREFIX + key) || ''; }
      function setValue(key, value) { localStorage.setItem(KEY_PREFIX + key, value || ''); }
      const paramDefaults = {
        tenantId: 'acme',
        jurisdiction: 'ES',
        sector: 'health-care',
      };

      function getContextValueForParam(paramName) {
        if (paramName === 'tenantId') return getValue('tenantId');
        if (paramName === 'jurisdiction') return getValue('jurisdiction');
        if (paramName === 'sector') return getValue('sector');
        return '';
      }

      function buildTemplateReplacements() {
        const testId = getValue('testId');
        const tenantId = getValue('tenantId');
        const taxId = getValue('taxId');
        const sector = getValue('sector');
        const offerId = getValue('offerId');
        const activationCode = getValue('activationCode');
        const licenseId = getValue('licenseId');
        return {
          '{{testId}}': testId,
          '{{id}}': testId,
          '<test-id>': testId,
          '{{tenantId}}': tenantId,
          '{{taxId}}': taxId,
          '{{sector}}': sector,
          '{{offerId}}': offerId,
          '<offer-id>': offerId,
          '{{activationCode}}': activationCode,
          '<license-activation-code>': activationCode,
          '{{licenseId}}': licenseId,
        };
      }

      function applyTemplateReplacements(inputText) {
        let output = String(inputText || '');
        const replacements = buildTemplateReplacements();
        for (const token of Object.keys(replacements)) {
          const value = replacements[token];
          if (value) output = output.split(token).join(value);
        }
        return output;
      }

      function syncSwaggerParameterInputs(force) {
        const rows = document.querySelectorAll('.parameters-container tr, .parameters tr');
        for (const row of rows) {
          const nameEl = row.querySelector('.parameter__name');
          const paramName = nameEl ? String(nameEl.textContent || '').trim().split('\\n')[0].trim() : '';
          if (!paramName) continue;
          const nextValue = getContextValueForParam(paramName);
          if (!nextValue) continue;

          const input = row.querySelector('input[type="text"], textarea');
          if (!input) continue;
          const currentValue = String(input.value || '').trim();
          const defaultValue = paramDefaults[paramName] || '';
          const canReplace = force || !currentValue || currentValue === defaultValue;
          if (!canReplace || currentValue === nextValue) continue;

          input.value = nextValue;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      function syncSwaggerRequestBodyEditors() {
        const testId = getValue('testId');
        const tenantId = getValue('tenantId');
        const taxId = getValue('taxId');
        const sector = getValue('sector');
        const activationCode = getValue('activationCode');
        const withTestId = (value) => {
          if (!testId || typeof value !== 'string') return value;
          if (value.includes('{{testId}}')) return value.split('{{testId}}').join(testId);
          if (value.includes('{{id}}')) return value.split('{{id}}').join(testId);
          if (value.includes('<test-id>')) return value.split('<test-id>').join(testId);
          if (value.endsWith('-' + testId)) return value;
          const looksLikeTemplateId =
            /(request-id|response-id|message-id|thread-id)$/i.test(value) ||
            /^thid-/i.test(value) ||
            /^jti-/i.test(value);
          return looksLikeTemplateId ? (value + '-' + testId) : value;
        };
        const applyKnownOverrides = (node) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) {
            for (const item of node) applyKnownOverrides(item);
            return;
          }

          if ('jti' in node) node.jti = withTestId(node.jti);
          if ('thid' in node) node.thid = withTestId(node.thid);
          if (activationCode && typeof node.subject_token === 'string') node.subject_token = activationCode;

          const claims = node.claims;
          if (claims && typeof claims === 'object') {
            if (tenantId) {
              if ('org.schema.Organization.alternateName' in claims) claims['org.schema.Organization.alternateName'] = tenantId;
              if ('Organization.alternateName' in claims) claims['Organization.alternateName'] = tenantId;
            }
            if (taxId) {
              if ('org.schema.Organization.identifier.value' in claims) claims['org.schema.Organization.identifier.value'] = taxId;
              if ('Organization.identifier.value' in claims) claims['Organization.identifier.value'] = taxId;
              if ('org.schema.Organization.identifierValue' in claims) claims['org.schema.Organization.identifierValue'] = taxId;
              if ('Organization.identifierValue' in claims) claims['Organization.identifierValue'] = taxId;
            }
            if (sector) {
              if ('org.schema.Service.category' in claims) claims['org.schema.Service.category'] = sector;
              if ('Service.category' in claims) claims['Service.category'] = sector;
            }
          }

          for (const value of Object.values(node)) {
            if (value && typeof value === 'object') applyKnownOverrides(value);
          }
        };

        const editors = document.querySelectorAll('textarea.body-param__text');
        for (const editor of editors) {
          const currentValue = String(editor.value || '');
          if (!currentValue) continue;
          let nextValue = applyTemplateReplacements(currentValue);
          try {
            const parsed = JSON.parse(nextValue);
            applyKnownOverrides(parsed);
            nextValue = JSON.stringify(parsed, null, 2);
          } catch (_) {
            // Keep raw body when editor content is not valid JSON.
          }
          if (nextValue === currentValue) continue;
          editor.value = nextValue;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      function nowTestId() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return String(d.getFullYear())
          + pad(d.getMonth() + 1)
          + pad(d.getDate())
          + pad(d.getHours())
          + pad(d.getMinutes())
          + pad(d.getSeconds());
      }

      function ensureDefaultContextValues() {
        const tenantId = getValue('tenantId') || 'acme';
        if (!getValue('tenantId')) {
          setValue('tenantId', tenantId);
        }
        if (!getValue('sector')) {
          setValue('sector', 'health-care');
        }
        if (!getValue('hostSector')) {
          setValue('hostSector', 'test');
        }
        if (!getValue('taxId')) {
          setValue('taxId', 'TaxNumber-' + tenantId);
        }
        if (!getValue('testId')) {
          setValue('testId', nowTestId());
        }
      }

      function upsertGlobalContextPanel() {
        if (document.getElementById('gw-api-global-context')) return;
        const panel = document.createElement('div');
        panel.id = 'gw-api-global-context';
        panel.style.position = 'fixed';
        panel.style.right = '12px';
        panel.style.bottom = '12px';
        panel.style.zIndex = '9999';
        panel.style.background = '#ffffff';
        panel.style.border = '1px solid #d9d9d9';
        panel.style.borderRadius = '8px';
        panel.style.padding = '10px';
        panel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        panel.style.width = '320px';
        panel.style.maxHeight = '70vh';
        panel.style.overflow = 'auto';
        panel.innerHTML = '<div style="font-weight:600;margin-bottom:8px;">Global Flow Context</div>';

        for (const field of fields) {
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = '110px 1fr';
          row.style.gap = '6px';
          row.style.alignItems = 'center';
          row.style.marginBottom = '6px';

          const label = document.createElement('label');
          label.textContent = field.label;
          label.style.fontSize = '12px';

          const input = document.createElement('input');
          input.type = 'text';
          input.id = 'gw-api-field-' + field.key;
          input.value = getValue(field.key);
          input.placeholder = field.placeholder;
          input.style.fontSize = '12px';
          input.style.padding = '4px 6px';
          input.style.border = '1px solid #d9d9d9';
          input.style.borderRadius = '4px';
          input.addEventListener('input', () => {
            setValue(field.key, input.value.trim());
            if (field.key === 'tenantId' || field.key === 'jurisdiction' || field.key === 'sector') {
              syncSwaggerParameterInputs(true);
            }
            syncSwaggerRequestBodyEditors();
          });

          row.appendChild(label);
          row.appendChild(input);
          panel.appendChild(row);
        }

        const hint = document.createElement('div');
        hint.style.fontSize = '11px';
        hint.style.color = '#555';
        hint.style.marginTop = '4px';
        hint.textContent =
          'Values are auto-applied to path params, placeholders ({{testId}}, {{id}}, <test-id>, {{offerId}}, {{activationCode}}), and template jti/thid fields.';
        panel.appendChild(hint);
        document.body.appendChild(panel);
      }

      function refreshInputIfEmpty(key, nextValue) {
        if (!nextValue) return;
        const input = document.getElementById('gw-api-field-' + key);
        if (input && input.value !== nextValue) {
          input.value = nextValue;
        }
      }

      function wireAutoFillFromResponses() {
        if (!window.ui || window.__gwApiResponseHooked) return;
        window.__gwApiResponseHooked = true;
      }

      function parseRgbColor(colorValue) {
        const match = String(colorValue || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
        if (!match) return null;
        return [Number(match[1]), Number(match[2]), Number(match[3])];
      }

      function isTransparentColor(colorValue) {
        const value = String(colorValue || '').trim().toLowerCase();
        return !value || value === 'transparent' || /^rgba\\(\\s*0\\s*,\\s*0\\s*,\\s*0\\s*,\\s*0\\s*\\)$/.test(value);
      }

      function isDarkBackgroundColor(colorValue) {
        const rgb = parseRgbColor(colorValue);
        if (!rgb) return false;
        const [r, g, b] = rgb.map((v) => v / 255);
        const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
        return luminance < 0.62;
      }

      function syncThemeContrastClass() {
        const root = document.documentElement;
        const uiEl = document.querySelector('.swagger-ui');
        const candidates = [
          uiEl ? getComputedStyle(uiEl).backgroundColor : '',
          getComputedStyle(document.body).backgroundColor,
          getComputedStyle(root).backgroundColor,
        ].filter((value) => !isTransparentColor(value));
        const bgColor = candidates[0] || '';
        const isDark = isDarkBackgroundColor(bgColor);
        root.classList.toggle('gw-api-docs-dark', isDark);
      }

      function init() {
        // Force typography fixes for long inline code (e.g., JWT examples) to avoid line overlap.
        if (!document.getElementById('gw-api-docs-inline-code-fix')) {
          const style = document.createElement('style');
          style.id = 'gw-api-docs-inline-code-fix';
          style.textContent = [
            '.swagger-ui .markdown p,',
            '.swagger-ui .markdown li,',
            '.swagger-ui .opblock-description-wrapper p,',
            '.swagger-ui .opblock-description-wrapper li,',
            '.swagger-ui .auth-container p,',
            '.swagger-ui .auth-container li { line-height: 1.5 !important; }',
            '.swagger-ui .markdown code,',
            '.swagger-ui .renderedMarkdown code,',
            '.swagger-ui .opblock-description-wrapper code,',
            '.swagger-ui .auth-container code,',
            '.swagger-ui .scheme-container code {',
            '  display: inline !important;',
            '  white-space: pre-wrap !important;',
            '  overflow-wrap: anywhere !important;',
            '  word-break: break-word !important;',
            '  line-height: 1.65 !important;',
            '  font-size: 12px !important;',
            '}',
            '.gw-api-docs-dark .swagger-ui .markdown,',
            '.gw-api-docs-dark .swagger-ui .renderedMarkdown,',
            '.gw-api-docs-dark .swagger-ui .opblock-description-wrapper,',
            '.gw-api-docs-dark .swagger-ui .auth-container { color: #e8e8e8 !important; }',
            '.gw-api-docs-dark .swagger-ui .markdown p,',
            '.gw-api-docs-dark .swagger-ui .markdown li,',
            '.gw-api-docs-dark .swagger-ui .markdown strong,',
            '.gw-api-docs-dark .swagger-ui .markdown em,',
            '.gw-api-docs-dark .swagger-ui .renderedMarkdown p,',
            '.gw-api-docs-dark .swagger-ui .renderedMarkdown li,',
            '.gw-api-docs-dark .swagger-ui .opblock-description-wrapper p,',
            '.gw-api-docs-dark .swagger-ui .opblock-description-wrapper li,',
            '.gw-api-docs-dark .swagger-ui .auth-container p,',
            '.gw-api-docs-dark .swagger-ui .auth-container li { color: #e8e8e8 !important; }',
            '.gw-api-docs-dark .swagger-ui .markdown li::marker,',
            '.gw-api-docs-dark .swagger-ui .renderedMarkdown li::marker,',
            '.gw-api-docs-dark .swagger-ui .opblock-description-wrapper li::marker { color: #e8e8e8 !important; }',
            '.gw-api-docs-dark .swagger-ui .responses-inner h4,',
            '.gw-api-docs-dark .swagger-ui .responses-inner h5,',
            '.gw-api-docs-dark .swagger-ui .responses-inner table th,',
            '.gw-api-docs-dark .swagger-ui .responses-inner table td,',
            '.gw-api-docs-dark .swagger-ui table.responses-table th,',
            '.gw-api-docs-dark .swagger-ui table.responses-table td,',
            '.gw-api-docs-dark .swagger-ui .response-col_links,',
            '.gw-api-docs-dark .swagger-ui .response-col_description,',
            '.gw-api-docs-dark .swagger-ui .response-col_status,',
            '.gw-api-docs-dark .swagger-ui .response-col_headers,',
            '.gw-api-docs-dark .swagger-ui .headers-wrapper,',
            '.gw-api-docs-dark .swagger-ui .headers-wrapper * { color: #e8e8e8 !important; }',
          ].join('\\n');
          document.head.appendChild(style);
        }

        syncThemeContrastClass();
        ensureDefaultContextValues();
        upsertGlobalContextPanel();
        wireAutoFillFromResponses();
        syncSwaggerParameterInputs(false);
        syncSwaggerRequestBodyEditors();

        const observer = new MutationObserver(() => {
          syncThemeContrastClass();
          syncSwaggerParameterInputs(false);
          syncSwaggerRequestBodyEditors();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }

      window.__gwApiDocsStore = {
        get: getValue,
        set: (key, value) => {
          setValue(key, value);
          refreshInputIfEmpty(key, value);
        },
      };
    })();
  `;

  return {
    customCss: `
      .swagger-ui .opblock-description-wrapper,
      .swagger-ui .opblock-description-wrapper p,
      .swagger-ui .opblock-description-wrapper li,
      .swagger-ui .markdown p,
      .swagger-ui .markdown li {
        line-height: 1.45 !important;
      }

      .swagger-ui .opblock-description-wrapper code,
      .swagger-ui .markdown code {
        white-space: normal !important;
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
        line-height: 1.5 !important;
        font-size: 0.95em !important;
      }
    `,
    swaggerOptions: {
      url: swaggerSpecUrl,
      parameterMacro: (operation: any, parameter: any) => {
        const browser: any = globalThis as any;
        const key = 'gw-api-docs:' + String(parameter?.name || '');
        const fallback = parameter?.schema?.example;
        const fromStorage = browser?.localStorage?.getItem ? browser.localStorage.getItem(key) : null;
        if (!fromStorage) return fallback;

        if (parameter?.name === 'sector') {
          const path = operation?.get ? String(operation.get('path') || '') : '';
          if (path.startsWith('/host/')) {
            const hostSector = browser?.localStorage?.getItem
              ? browser.localStorage.getItem('gw-api-docs:hostSector')
              : null;
            return hostSector || fromStorage;
          }
        }
        return fromStorage;
      },
      requestInterceptor: (request: any) => {
        const browser: any = globalThis as any;
        const getCtx = (key: string) =>
          browser?.localStorage?.getItem ? browser.localStorage.getItem('gw-api-docs:' + key) || '' : '';
        const testId = getCtx('testId');
        const tenantId = getCtx('tenantId');
        const jurisdiction = getCtx('jurisdiction');
        const taxId = getCtx('taxId');
        const sector = getCtx('sector');
        const hostSector = getCtx('hostSector');
        const offerId = getCtx('offerId');
        const activationCode = getCtx('activationCode');

        if (typeof request.url === 'string') {
          request.url = request.url.replace(
            /\/([^/]+)\/cds-([^/]+)\/v1\/([^/]+)\//,
            (_full: string, currentTenant: string, currentJurisdiction: string, currentSector: string) => {
              const nextTenant = currentTenant === 'host' ? 'host' : (tenantId || currentTenant);
              const nextJurisdiction = jurisdiction || currentJurisdiction;
              const nextSector = currentTenant === 'host'
                ? (hostSector || currentSector)
                : (sector || currentSector);
              return `/${nextTenant}/cds-${nextJurisdiction}/v1/${nextSector}/`;
            },
          );
        }

        const replacements: Record<string, string> = {
          '{{testId}}': testId,
          '{{id}}': testId,
          '<test-id>': testId,
          '{{tenantId}}': tenantId,
          '{{taxId}}': taxId,
          '{{sector}}': sector,
          '{{offerId}}': offerId,
          '<offer-id>': offerId,
          '{{activationCode}}': activationCode,
          '<license-activation-code>': activationCode,
          '{{licenseId}}': getCtx('licenseId'),
        };

        const applyKnownOverrides = (node: any) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) {
            for (const item of node) applyKnownOverrides(item);
            return;
          }

          const withTestId = (value: unknown): unknown => {
            if (!testId || typeof value !== 'string') return value;
            if (value.includes('{{testId}}')) {
              return value.split('{{testId}}').join(testId);
            }
            if (value.includes('{{id}}')) {
              return value.split('{{id}}').join(testId);
            }
            if (value.includes('<test-id>')) {
              return value.split('<test-id>').join(testId);
            }
            if (value.endsWith('-' + testId)) return value;
            const looksLikeTemplateId =
              /(request-id|response-id|message-id|thread-id)$/i.test(value) ||
              /^thid-/i.test(value) ||
              /^jti-/i.test(value);
            return looksLikeTemplateId ? (value + '-' + testId) : value;
          };

          if ('jti' in node) node.jti = withTestId(node.jti);
          if ('thid' in node) node.thid = withTestId(node.thid);

          if (activationCode && typeof node.subject_token === 'string') {
            node.subject_token = activationCode;
          }

          const claims = node.claims;
          if (claims && typeof claims === 'object') {
            if (tenantId) {
              if ('org.schema.Organization.alternateName' in claims) {
                claims['org.schema.Organization.alternateName'] = tenantId;
              }
              if ('Organization.alternateName' in claims) {
                claims['Organization.alternateName'] = tenantId;
              }
            }
            if (taxId) {
              if ('org.schema.Organization.identifier.value' in claims) {
                claims['org.schema.Organization.identifier.value'] = taxId;
              }
              if ('Organization.identifier.value' in claims) {
                claims['Organization.identifier.value'] = taxId;
              }
              if ('org.schema.Organization.identifierValue' in claims) {
                claims['org.schema.Organization.identifierValue'] = taxId;
              }
              if ('Organization.identifierValue' in claims) {
                claims['Organization.identifierValue'] = taxId;
              }
            }
            if (sector) {
              if ('org.schema.Service.category' in claims) {
                claims['org.schema.Service.category'] = sector;
              }
              if ('Service.category' in claims) {
                claims['Service.category'] = sector;
              }
            }
            if (offerId) {
              if ('Order.acceptedOffer.identifier' in claims) {
                claims['Order.acceptedOffer.identifier'] = offerId;
              }
              if ('org.schema.Order.acceptedOffer.identifier' in claims) {
                claims['org.schema.Order.acceptedOffer.identifier'] = offerId;
              }
            }
          }

          for (const value of Object.values(node)) {
            if (value && typeof value === 'object') applyKnownOverrides(value);
          }
        };

        if (typeof request.body === 'string') {
          for (const [token, value] of Object.entries(replacements)) {
            if (value) {
              request.body = request.body.split(token).join(value);
            }
          }
          try {
            const parsed = JSON.parse(request.body);
            applyKnownOverrides(parsed);
            request.body = JSON.stringify(parsed);
          } catch (_) {
            // Keep raw body for non-JSON payloads (e.g., form-encoded secure mode).
          }
        } else if (request.body && typeof request.body === 'object') {
          let serialized = JSON.stringify(request.body);
          for (const [token, value] of Object.entries(replacements)) {
            if (value) {
              serialized = serialized.split(token).join(value);
            }
          }
          request.body = JSON.parse(serialized);
          applyKnownOverrides(request.body);
        }
        return request;
      },
      responseInterceptor: (response: any) => {
        const browser: any = globalThis as any;
        try {
          const contentType =
            response?.headers?.['content-type'] ||
            response?.headers?.['Content-Type'] ||
            '';
          if (!String(contentType).includes('json')) return response;
          const payload = response?.data ?? response?.body ?? response?.text;
          if (!payload) return response;
          const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
          const entries = data?.data || data?.entry;
          if (!Array.isArray(entries)) return response;

          let offerId = '';
          let activationCode = '';
          let licenseId = '';
          for (const entry of entries) {
            const claims = entry?.meta?.claims;
            if (!claims || typeof claims !== 'object') continue;
            if (!offerId && typeof claims['org.schema.Offer.identifier'] === 'string') {
              offerId = claims['org.schema.Offer.identifier'];
            }
            if (!activationCode && typeof claims['org.schema.IndividualProduct.serialNumber'] === 'string') {
              activationCode = claims['org.schema.IndividualProduct.serialNumber'];
            }
            if (!licenseId && typeof claims['org.schema.Offer.serialNumber'] === 'string') {
              licenseId = claims['org.schema.Offer.serialNumber'].split(',')[0]?.trim();
            }
          }

          if (browser?.localStorage?.setItem) {
            if (offerId) browser.localStorage.setItem('gw-api-docs:offerId', offerId);
            if (activationCode) browser.localStorage.setItem('gw-api-docs:activationCode', activationCode);
            if (licenseId) browser.localStorage.setItem('gw-api-docs:licenseId', licenseId);
            if (browser.__gwApiDocsStore) {
              if (offerId) browser.__gwApiDocsStore.set('offerId', offerId);
              if (activationCode) browser.__gwApiDocsStore.set('activationCode', activationCode);
              if (licenseId) browser.__gwApiDocsStore.set('licenseId', licenseId);
            }
          }
        } catch (_) {
          // Ignore interceptor parsing errors: responses can be non-JSON in secure mode.
        }
        return response;
      },
      persistAuthorization: true,
    },
    customJsStr: globalContextScript,
  };
}
