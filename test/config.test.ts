import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION, APP_NAME, CONFIG_DIR, getPizzaDir } from "../src/config.js";
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
});
