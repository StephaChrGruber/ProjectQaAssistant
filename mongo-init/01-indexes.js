db = db.getSiblingDB("project_qa");

// Projects: stores repo_path/default_branch/name/key
db.projects.createIndex({ name: "text", key: "text" }, { name: "projects_text_idx" });

// Chunks: stores extracted docs from confluence/github etc
// Adjust fields if your chunks use different names!
db.chunks.createIndex(
    { text: "text", path: "text", title: "text" },
    { name: "chunks_text_idx", default_language: "english" }
);

// Helpful filters
db.chunks.createIndex({ project_id: 1, branch: 1, source: 1 }, { name: "chunks_filters_idx" });


db.chats.createIndex({ chat_id: 1 }, { unique: true });
db.chats.createIndex({ project_id: 1, branch: 1, user: 1 });
db.chats.createIndex({ updated_at: -1 });
