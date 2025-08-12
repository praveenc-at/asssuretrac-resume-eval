"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Upload, FileText, Download, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { evaluateResumesWithLangGraphAgent } from "./langgraphAgent";
import { UploadedFile, EvaluationResponse } from "./types";

export default function ResumeEvaluator() {
  const [evaluationCriteria, setEvaluationCriteria] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobDescriptionFile, setJobDescriptionFile] = useState<File | null>(
    null
  );
  const [resumes, setResumes] = useState<UploadedFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<EvaluationResponse | null>(null);
  const [error, setError] = useState("");

  const handleJobDescriptionFileUpload = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      setJobDescriptionFile(file);
      // Read file content for text files
      if (file.type === "text/plain") {
        const reader = new FileReader();
        reader.onload = (e) => {
          setJobDescription(e.target?.result as string);
        };
        reader.readAsText(file);
      }
    }
  };

  const handleResumeUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newResumes: UploadedFile[] = Array.from(files).map((file) => ({
        file,
        id: Math.random().toString(36).substr(2, 9),
      }));
      setResumes((prev) => [...prev, ...newResumes]);
    }
  };

  const removeResume = (id: string) => {
    setResumes((prev) => prev.filter((resume) => resume.id !== id));
  };

  const simulateLangGraphAgent = async (): Promise<EvaluationResponse> => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const responseTypes = ["json", "tabular", "text"] as const;
    const randomType =
      responseTypes[Math.floor(Math.random() * responseTypes.length)];

    switch (randomType) {
      case "json":
        return {
          type: "json",
          data: {
            summary: "Resume evaluation completed",
            totalResumes: resumes.length,
            averageScore: 7.5,
            topCandidates: [
              { name: "John Doe", score: 9.2, match: "95%" },
              { name: "Jane Smith", score: 8.7, match: "87%" },
              { name: "Mike Johnson", score: 8.1, match: "81%" },
            ],
          },
          excelData: [
            {
              Name: "John Doe",
              Score: 9.2,
              Match: "95%",
              Skills: "React, TypeScript, Node.js",
            },
            {
              Name: "Jane Smith",
              Score: 8.7,
              Match: "87%",
              Skills: "Python, Django, PostgreSQL",
            },
            {
              Name: "Mike Johnson",
              Score: 8.1,
              Match: "81%",
              Skills: "Java, Spring Boot, MySQL",
            },
          ],
        };

      case "tabular":
        return {
          type: "tabular",
          data: [
            {
              candidate: "John Doe",
              experience: "5 years",
              skills: "React, TypeScript",
              score: 9.2,
            },
            {
              candidate: "Jane Smith",
              experience: "3 years",
              skills: "Python, Django",
              score: 8.7,
            },
            {
              candidate: "Mike Johnson",
              experience: "4 years",
              skills: "Java, Spring",
              score: 8.1,
            },
            {
              candidate: "Sarah Wilson",
              experience: "6 years",
              skills: "Angular, Node.js",
              score: 7.9,
            },
          ],
          excelData: [
            {
              Candidate: "John Doe",
              Experience: "5 years",
              Skills: "React, TypeScript",
              Score: 9.2,
            },
            {
              Candidate: "Jane Smith",
              Experience: "3 years",
              Skills: "Python, Django",
              Score: 8.7,
            },
            {
              Candidate: "Mike Johnson",
              Experience: "4 years",
              Skills: "Java, Spring",
              Score: 8.1,
            },
            {
              Candidate: "Sarah Wilson",
              Experience: "6 years",
              Skills: "Angular, Node.js",
              Score: 7.9,
            },
          ],
        };

      default:
        return {
          type: "text",
          data: `Resume Evaluation Report

Based on the provided evaluation criteria and job description, we have analyzed ${resumes.length} resumes.

Key Findings:
• 75% of candidates meet the basic requirements
• Top 3 candidates show strong technical skills alignment
• Average experience level: 4.5 years
• Most common skills: JavaScript, React, Python

Recommendations:
1. Schedule interviews with top 3 candidates
2. Consider additional technical assessments
3. Review soft skills during interviews

Detailed analysis shows strong potential in the candidate pool with several standout profiles that closely match the job requirements.`,
          excelData: [
            { Metric: "Total Resumes", Value: resumes.length },
            {
              Metric: "Qualified Candidates",
              Value: Math.floor(resumes.length * 0.75),
            },
            { Metric: "Average Score", Value: 7.5 },
            { Metric: "Top Score", Value: 9.2 },
          ],
        };
    }
  };

  const handleSubmit = async () => {
    if (!evaluationCriteria.trim()) {
      setError("Please enter evaluation criteria");
      return;
    }

    if (!jobDescription.trim() && !jobDescriptionFile) {
      setError("Please provide a job description");
      return;
    }

    if (resumes.length === 0) {
      setError("Please upload at least one resume");
      return;
    }

    setError("");
    setIsLoading(true);

    console.log("Submitting evaluation with criteria:");
    try {
      const response = await evaluateResumesWithLangGraphAgent(
        resumes,
        evaluationCriteria,
        jobDescription
      );
      setResults(response);
    } catch (err) {
      setError("Failed to process evaluation. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const downloadExcel = () => {
    if (!results?.excelData) return;

    const headers = Object.keys(results.excelData[0]).join(",");
    const rows = results.excelData
      .map((row) =>
        Object.values(row)
          .map((value) => `"${value}"`)
          .join(",")
      )
      .join("\n");

    const csvContent = `${headers}\n${rows}`;
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume-evaluation-report.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const renderResults = () => {
    if (!results) return null;

    switch (results.type) {
      case "json":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Evaluation Results (JSON)</h3>
            <pre className="bg-gray-100 p-4 rounded-lg overflow-auto text-sm">
              {JSON.stringify(results.data, null, 2)}
            </pre>
          </div>
        );

      case "text":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Evaluation Results (Text)</h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              <pre className="whitespace-pre-wrap text-sm">{results.data}</pre>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Resume Evaluator</h1>
          <p className="text-gray-600 mt-2">
            Upload resumes and job descriptions for AI-powered evaluation
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Evaluation Criteria */}
        <Card>
          <CardHeader>
            <CardTitle>Evaluation Criteria</CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="criteria">Enter your evaluation criteria</Label>
            <Textarea
              id="criteria"
              placeholder="e.g., Technical skills, years of experience, education background, soft skills..."
              value={evaluationCriteria}
              onChange={(e) => setEvaluationCriteria(e.target.value)}
              className="mt-2 min-h-[100px]"
            />
          </CardContent>
        </Card>

        {/* Job Description */}
        <Card>
          <CardHeader>
            <CardTitle>Job Description</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="jd-file">Upload Job Description File</Label>
              <Input
                id="jd-file"
                type="file"
                accept=".txt,.pdf,.doc,.docx"
                onChange={handleJobDescriptionFileUpload}
                className="mt-2"
              />
              {jobDescriptionFile && (
                <p className="text-sm text-gray-600 mt-1">
                  Uploaded: {jobDescriptionFile.name}
                </p>
              )}
            </div>

            <div className="text-center text-gray-500">OR</div>

            <div>
              <Label htmlFor="jd-text">Enter Job Description Text</Label>
              <Textarea
                id="jd-text"
                placeholder="Paste or type the job description here..."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                className="mt-2 min-h-[150px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* Resume Upload */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Resumes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="resumes">Select Resume Files</Label>
              <Input
                id="resumes"
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt"
                onChange={handleResumeUpload}
                className="mt-2"
              />
            </div>

            {resumes.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">
                  Uploaded Resumes ({resumes.length})
                </h4>
                <div className="grid gap-2">
                  {resumes.map((resume) => (
                    <div
                      key={resume.id}
                      className="flex items-center justify-between bg-gray-50 p-3 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{resume.file.name}</span>
                        <span className="text-xs text-gray-500">
                          ({(resume.file.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeResume(resume.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="text-center">
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            size="lg"
            className="px-8"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Evaluate Resumes
              </>
            )}
          </Button>
        </div>

        {/* Results Section (keeps JSON/Text only) */}
        {results && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Evaluation Results</CardTitle>
              {results.excelData && (
                <Button onClick={downloadExcel} variant="outline" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Download Excel Report
                </Button>
              )}
            </CardHeader>
            <CardContent>{renderResults()}</CardContent>
          </Card>
        )}

        {/* Excel Report Preview (keeps this) */}
        {results?.excelData && (
          <Card>
            <CardHeader>
              <CardTitle>Excel Report Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-green-50">
                      {Object.keys(results.excelData[0]).map((key) => (
                        <th
                          key={key}
                          className="border border-gray-300 px-4 py-2 text-left font-medium"
                        >
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.excelData.map((row: any, index: number) => (
                      <tr key={index} className="hover:bg-gray-50">
                        {Object.values(row).map((value: any, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="border border-gray-300 px-4 py-2"
                          >
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
