import type { DatasetDefinition } from "../query/types";
import { datasetDefinitionsFromCatalog } from "../../semantic/businessCatalog";

export const MVP_DATASET_DEFINITIONS: DatasetDefinition[] = datasetDefinitionsFromCatalog();

export const datasetDefinition = (datasetId: string) => MVP_DATASET_DEFINITIONS.find((item) => item.datasetId === datasetId);
