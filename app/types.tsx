export interface UploadedFile {
  file: File;
  id: string;
}

export type EvaluationResponse = {
  type: "json" | "tabular" | "text";
  data: any;
  excelData?: any[]; // array of row objects with column names as keys
};
