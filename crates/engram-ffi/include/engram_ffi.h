#ifndef ENGRAM_FFI_H
#define ENGRAM_FFI_H

#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct EngramArchiveHandle EngramArchiveHandle;
typedef struct EngramDatabaseHandle EngramDatabaseHandle;

typedef struct {
    uint8_t *data;
    size_t len;
} EngramBuffer;

typedef struct {
    char **data;
    size_t len;
} EngramStringList;

int32_t engram_open_archive(const char *path, EngramArchiveHandle **out_handle, char **out_error);
void engram_close_archive(EngramArchiveHandle *handle);

int32_t engram_archive_entry_count(EngramArchiveHandle *handle, uint32_t *out_count, char **out_error);
int32_t engram_archive_contains(EngramArchiveHandle *handle, const char *path, bool *out_result, char **out_error);
int32_t engram_archive_list_files(EngramArchiveHandle *handle, EngramStringList *out_list, char **out_error);
int32_t engram_archive_list_prefix(EngramArchiveHandle *handle, const char *prefix, EngramStringList *out_list, char **out_error);
int32_t engram_archive_read_file(EngramArchiveHandle *handle, const char *path, EngramBuffer *out_buffer, char **out_error);
int32_t engram_archive_read_text(EngramArchiveHandle *handle, const char *path, char **out_text, char **out_error);
int32_t engram_archive_read_json(EngramArchiveHandle *handle, const char *path, char **out_json, char **out_error);
int32_t engram_archive_get_metadata(EngramArchiveHandle *handle, const char *path, char **out_json, char **out_error);
int32_t engram_archive_read_manifest(EngramArchiveHandle *handle, char **out_json, char **out_error);

int32_t engram_archive_open_database(EngramArchiveHandle *handle, const char *path, EngramDatabaseHandle **out_db, char **out_error);
void engram_database_close(EngramDatabaseHandle *db);
int32_t engram_database_query(EngramDatabaseHandle *db, const char *sql, const char *params_json, char **out_json, char **out_error);
int32_t engram_database_execute(EngramDatabaseHandle *db, const char *sql, const char *params_json, int64_t *out_rows, char **out_error);

void engram_free_cstring(char *ptr);
void engram_buffer_free(EngramBuffer buffer);
void engram_string_list_free(EngramStringList list);

#ifdef __cplusplus
}
#endif

#endif /* ENGRAM_FFI_H */
