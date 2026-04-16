import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';

/**
 * Tests for SDKAgent permission mode configuration (Issue #1893)
 *
 * Verifies that the CLAUDE_MEM_PERMISSION_MODE setting is read from
 * user settings and correctly determines the permissionMode and
 * allowDangerouslySkipPermissions values passed to the SDK query() call.
 */
describe('SDKAgent Permission Mode (Issue #1893)', () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `perm-mode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    settingsPath = join(tempDir, 'settings.json');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Restore env
    delete process.env.CLAUDE_MEM_PERMISSION_MODE;
  });

  /**
   * Helper that mirrors the permission mode logic in SDKAgent.startSession().
   * Extracts the relevant options that would be passed to query().
   */
  function buildPermissionOptions(settings: { CLAUDE_MEM_PERMISSION_MODE: string }) {
    const permissionMode = settings.CLAUDE_MEM_PERMISSION_MODE;
    const isBypass = permissionMode === 'bypassPermissions';
    return {
      permissionMode,
      ...(isBypass && { allowDangerouslySkipPermissions: true }),
    };
  }

  describe('default behavior', () => {
    it('should default to "default" permission mode when no setting is configured', () => {
      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);

      expect(settings.CLAUDE_MEM_PERMISSION_MODE).toBe('default');
    });

    it('should NOT set allowDangerouslySkipPermissions when mode is "default"', () => {
      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      const options = buildPermissionOptions(settings);

      expect(options.permissionMode).toBe('default');
      expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    });
  });

  describe('bypassPermissions mode', () => {
    it('should respect bypassPermissions from settings file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_PERMISSION_MODE: 'bypassPermissions',
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);

      expect(settings.CLAUDE_MEM_PERMISSION_MODE).toBe('bypassPermissions');
    });

    it('should set allowDangerouslySkipPermissions when mode is "bypassPermissions"', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_PERMISSION_MODE: 'bypassPermissions',
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      const options = buildPermissionOptions(settings);

      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
    });
  });

  describe('environment variable override', () => {
    it('should allow env var to override file setting to bypassPermissions', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_PERMISSION_MODE: 'default',
      }));
      process.env.CLAUDE_MEM_PERMISSION_MODE = 'bypassPermissions';

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      const options = buildPermissionOptions(settings);

      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('should allow env var to override file setting to default', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_PERMISSION_MODE: 'bypassPermissions',
      }));
      process.env.CLAUDE_MEM_PERMISSION_MODE = 'default';

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      const options = buildPermissionOptions(settings);

      expect(options.permissionMode).toBe('default');
      expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should treat unknown mode values as non-bypass (safe default)', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_PERMISSION_MODE: 'unknownMode',
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      const options = buildPermissionOptions(settings);

      expect(options.permissionMode).toBe('unknownMode');
      expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    });

    it('should not set allowDangerouslySkipPermissions for empty string', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_PERMISSION_MODE: '',
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      const options = buildPermissionOptions(settings);

      expect(options.permissionMode).toBe('');
      expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    });
  });
});
