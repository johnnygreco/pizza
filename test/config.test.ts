import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERSION,
  APP_NAME,
  CONFIG_DIR,
  PI_PROJECT_CONFIG_DIR,
  getAuthPath,
  getGlobalResourceDirs,
  getModelsPath,
  getPizzaDir,
  getProjectPizzaDir,
  getProjectResourceDirs,
} from "../src/config.js";
import { homedir } from "node:os";

const pkg = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf-8",
  ),
);

describe("config", () => {
  describe("constants", () => {
    it("VERSION matches package.json", () => {
      expect(VERSION).toBe(pkg.version);
    });

    it("APP_NAME is pizza", () => {
      expect(APP_NAME).toBe("pizza");
    });

    it("CONFIG_DIR is .pizza", () => {
      expect(CONFIG_DIR).toBe(".pizza");
    });

    it("Pi project-local dir remains .pi", () => {
      expect(PI_PROJECT_CONFIG_DIR).toBe(".pi");
    });
  });

  describe("getPizzaDir", () => {
    const originalEnv = process.env.PIZZA_DIR;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PIZZA_DIR;
      } else {
        process.env.PIZZA_DIR = originalEnv;
      }
    });

    it("defaults to ~/.pizza", () => {
      delete process.env.PIZZA_DIR;
      expect(getPizzaDir()).toBe(resolve(homedir(), ".pizza"));
    });

    it("respects PIZZA_DIR env var", () => {
      process.env.PIZZA_DIR = "/tmp/custom-pizza";
      expect(getPizzaDir()).toBe("/tmp/custom-pizza");
    });

    it("expands tilde in PIZZA_DIR", () => {
      process.env.PIZZA_DIR = "~/my-pizza";
      expect(getPizzaDir()).toBe(resolve(homedir(), "my-pizza"));
    });

    it("expands bare tilde", () => {
      process.env.PIZZA_DIR = "~";
      expect(getPizzaDir()).toBe(homedir());
    });
  });

  describe("path helpers", () => {
    it("builds auth and models paths under the pizza dir", () => {
      expect(getAuthPath("/tmp/pizza")).toBe("/tmp/pizza/auth.json");
      expect(getModelsPath("/tmp/pizza")).toBe("/tmp/pizza/models.json");
    });

    it("builds global resource directories under the pizza dir", () => {
      expect(getGlobalResourceDirs("/tmp/pizza")).toEqual({
        extensions: "/tmp/pizza/extensions",
        prompts: "/tmp/pizza/prompts",
        skills: "/tmp/pizza/skills",
        themes: "/tmp/pizza/themes",
      });
    });

    it("builds project-local .pizza directories", () => {
      expect(getProjectPizzaDir("/tmp/project")).toBe("/tmp/project/.pizza");
      expect(getProjectResourceDirs("/tmp/project")).toEqual({
        extensions: "/tmp/project/.pizza/extensions",
        prompts: "/tmp/project/.pizza/prompts",
        skills: "/tmp/project/.pizza/skills",
        themes: "/tmp/project/.pizza/themes",
      });
    });
  });
});
