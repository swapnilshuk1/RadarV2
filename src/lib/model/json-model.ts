        modelConfigurationFingerprint: this.configurationFingerprint,
        requestFingerprint,
        stage: metadata?.stage ?? "unspecified",
        attempt: metadata?.attempt ?? 1,
        maxOutputTokens,
        startedAt,
        completedAt: Date.now(),
        finishReason,
        status,
        errorCode,
        usage,
      });
    };

    try {
      const response = await withProviderConcurrency(
        `vertex-gemini:${this.projectId}:${location}`,
        this.options.providerConcurrencyLimit ??
          Number(process.env.RADAR_MODEL_PROVIDER_CONCURRENCY || "6"),
        async () =>
          this.request(
            `https://${host}/v1/projects/${this.projectId}/locations/${location}/publishers/google/models/${this.version}:generateContent`,
            {
              method: "POST",
              signal: AbortSignal.timeout(this.options.timeoutMs ?? 90000),
              headers: {
                Authorization: `Bearer ${await this.token()}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: instruction }] },
                contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
                generationConfig: {
                  ...(this.version.startsWith("gemini-3")
                    ? {}
                    : { temperature: this.options.temperature ?? 0 }),
                  responseMimeType: "application/json",
                  ...(responseSchema
                    ? {
                        [this.schemaFormat === "json-schema"
                          ? "responseJsonSchema"
                          : "responseSchema"]: responseSchema,
                      }
                    : {}),
                  maxOutputTokens,
                  ...(this.version.startsWith("gemini-3")
                    ? { thinkingConfig: { thinkingLevel: this.options.thinkingLevel ?? "MEDIUM" } }
                    : { thinkingConfig: { thinkingBudget: 0 } }),
                },
              }),
            },