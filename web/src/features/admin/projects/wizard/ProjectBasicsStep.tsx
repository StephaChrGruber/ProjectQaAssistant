"use client"

import type { Dispatch, SetStateAction } from "react"
import { Stack, TextField } from "@mui/material"
import type { ProjectForm } from "@/features/admin/projects/form-model"

type ProjectBasicsStepProps = {
    createForm: ProjectForm
    setCreateForm: Dispatch<SetStateAction<ProjectForm>>
}

export default function ProjectBasicsStep({ createForm, setCreateForm }: ProjectBasicsStepProps) {
    return (
        <Stack spacing={1.5}>
            <TextField
                label="Project Key"
                value={createForm.key}
                onChange={(e) => setCreateForm((f) => ({ ...f, key: e.target.value }))}
                placeholder="qa-assist"
                required
                fullWidth
                size="small"
            />
            <TextField
                label="Project Name"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="QA Assistant"
                required
                fullWidth
                size="small"
            />
            <TextField
                label="Description"
                value={createForm.description}
                onChange={(e) =>
                    setCreateForm((f) => ({ ...f, description: e.target.value }))
                }
                multiline
                minRows={3}
                fullWidth
                size="small"
            />
        </Stack>
    )
}
