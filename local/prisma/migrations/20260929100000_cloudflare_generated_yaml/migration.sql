ALTER TABLE "Subscription"
ADD COLUMN "encryptedGeneratedYaml" TEXT,
ADD COLUMN "generatedYamlUpdatedAt" TIMESTAMP(3),
ADD COLUMN "generatedYamlSha256" TEXT;
