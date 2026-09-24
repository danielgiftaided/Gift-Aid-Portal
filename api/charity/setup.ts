import type {
  VercelRequest,
  VercelResponse,
} from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";
import { logActivity } from "../_utils/activityLog.js";

function send(
  res: VercelResponse,
  status: number,
  body: object,
) {
  return res.status(status).json(body);
}

function parseBody(req: VercelRequest) {
  const body = (req as any).body;

  if (!body) {
    return {};
  }

  if (typeof body === "object") {
    return body;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return {};
}

function getTaxYearForDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return month > 4 || (month === 4 && day >= 6)
    ? `${year}/${String(year + 1).slice(2)}`
    : `${year - 1}/${String(year).slice(2)}`;
}

function parseDonationDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  const dmy = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/,
  );

  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    const year =
      dmy[3].length === 2
        ? 2000 + parseInt(dmy[3], 10)
        : parseInt(dmy[3], 10);

    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      const date = new Date(year, month - 1, day);

      if (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
      ) {
        return date;
      }
    }
  }

  const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10);
    const day = parseInt(ymd[3], 10);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date;
    }
  }

  const fallback = new Date(trimmed);

  return Number.isNaN(fallback.getTime())
    ? null
    : fallback;
}

/**
 * Move spreadsheet rows staged before registration into the charity's
 * submissions, donations, and uploaded-record tables.
 *
 * A migration error is logged but does not prevent account setup.
 */
async function migratePendingData(
  userEmail: string,
  charityId: string,
) {
  try {
    const normalisedEmail = userEmail
      .trim()
      .toLowerCase();

    const { data: pendingRows } = await supabaseAdmin
      .from("pending_uploaded_records")
      .select("*")
      .eq("pending_email", normalisedEmail);

    if (!pendingRows || pendingRows.length === 0) {
      await supabaseAdmin
        .from("pending_charities")
        .update({
          status: "completed",
          charity_id: charityId,
          completed_at: new Date().toISOString(),
        })
        .eq("email", normalisedEmail);

      return;
    }

    const validRows = pendingRows.filter(
      (row) => row.record_status === "valid",
    );

    const byTaxYear: Record<
      string,
      typeof validRows
    > = {};

    for (const row of validRows) {
      const taxYear =
        row.tax_year ||
        getTaxYearForDate(
          parseDonationDate(row.donation_date) ??
            new Date(),
        );

      if (!byTaxYear[taxYear]) {
        byTaxYear[taxYear] = [];
      }

      byTaxYear[taxYear].push(row);
    }

    const submissionIdByPendingRow: Record<
      string,
      string
    > = {};

    for (const [taxYear, rows] of Object.entries(
      byTaxYear,
    )) {
      const totalDonations = rows.reduce(
        (sum, row) =>
          sum +
          (parseFloat(String(row.amount)) || 0),
        0,
      );

      const giftAid =
        Math.round(totalDonations * 0.25 * 100) /
        100;

      const {
        data: newSubmission,
        error: submissionError,
      } = await supabaseAdmin
        .from("submissions")
        .insert({
          charity_id: charityId,
          submission_date: new Date()
            .toISOString()
            .split("T")[0],
          tax_year: taxYear,
          amount_claimed: giftAid,
          number_of_donations: rows.length,
          status: "pending",
        })
        .select("id")
        .single();

      if (submissionError || !newSubmission) {
        continue;
      }

      for (const row of rows) {
        submissionIdByPendingRow[row.id] =
          newSubmission.id;
      }

      await supabaseAdmin
        .from("donations")
        .insert(
          rows.map((row) => ({
            submission_id: newSubmission.id,
            charity_id: charityId,
            title: row.title || null,
            first_name: row.first_name,
            last_name: row.last_name,
            address: row.address,
            postcode: row.postcode,
            donation_date: row.donation_date,
            amount: row.amount,
          })),
        );
    }

    await supabaseAdmin
      .from("uploaded_records")
      .insert(
        pendingRows.map((row) => ({
          charity_id: charityId,
          submission_id:
            submissionIdByPendingRow[row.id] ??
            null,
          title: row.title || null,
          first_name: row.first_name,
          last_name: row.last_name,
          address: row.address,
          postcode: row.postcode,
          donation_date: row.donation_date,
          amount: row.amount,
          gift_aid_opt_in: row.gift_aid_opt_in,
          record_status: row.record_status,
          tax_year:
            row.tax_year ||
            getTaxYearForDate(
              parseDonationDate(
                row.donation_date,
              ) ?? new Date(),
            ),
        })),
      );

    await supabaseAdmin
      .from("pending_uploaded_records")
      .delete()
      .eq("pending_email", normalisedEmail);

    await supabaseAdmin
      .from("pending_charities")
      .update({
        status: "completed",
        charity_id: charityId,
        completed_at: new Date().toISOString(),
      })
      .eq("email", normalisedEmail);
  } catch (error) {
    console.error(
      "migratePendingData failed:",
      error,
    );
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    if (req.method !== "POST") {
      return send(res, 405, {
        ok: false,
        error: "Method not allowed",
      });
    }

    const user = await requireUser(req);
    const userId = user?.id;
    const userEmail = user?.email;

    if (!userId) {
      return send(res, 401, {
        ok: false,
        error: "Invalid session user",
      });
    }

    const body = parseBody(req);

    const name = String(body.name || "").trim();
    const contactEmail = String(
      body.contact_email || "",
    ).trim();
    const hmrcReference = String(
      body.hmrc_ref || "",
    )
      .trim()
      .toUpperCase();
    const charityCommissionNumber = String(
      body.charity_commission_number || "",
    ).trim();
    const authorisedOfficialName = String(
      body.authorised_official_name || "",
    ).trim();

    if (!name) {
      return send(res, 400, {
        ok: false,
        error: "Charity name is required",
      });
    }

    if (!contactEmail) {
      return send(res, 400, {
        ok: false,
        error: "Contact email is required",
      });
    }

    if (!hmrcReference) {
      return send(res, 400, {
        ok: false,
        error: "HMRC Charities Ref is required",
      });
    }

    if (!charityCommissionNumber) {
      return send(res, 400, {
        ok: false,
        error:
          "Charity Commission Number is required",
      });
    }

    if (!authorisedOfficialName) {
      return send(res, 400, {
        ok: false,
        error:
          "Authorised Official's name is required",
      });
    }

    if (
      !/^[A-Z]{1,2}[0-9]{1,5}$/.test(
        hmrcReference,
      )
    ) {
      return send(res, 400, {
        ok: false,
        error:
          'HMRC Charities Ref must be 1-2 letters followed by 1-5 numbers (e.g. "AB12345"). This is your HMRC Gift Aid reference, not your Charity Commission number.',
      });
    }

    if (/\/(0|1|2)$/.test(hmrcReference)) {
      return send(res, 400, {
        ok: false,
        error:
          "HMRC Charities Ref cannot end in /0, /1 or /2 — HMRC no longer accepts these sub-fund suffixes.",
      });
    }

    const {
      data: existingUser,
      error: userError,
    } = await supabaseAdmin
      .from("users")
      .select("id, charity_id")
      .eq("id", userId)
      .maybeSingle();

    if (userError) {
      return send(res, 500, {
        ok: false,
        error: userError.message,
      });
    }

    if (!existingUser) {
      return send(res, 500, {
        ok: false,
        error:
          "User row not found. Please contact support.",
      });
    }

    if (existingUser.charity_id) {
      return send(res, 200, {
        ok: true,
        charity_id: existingUser.charity_id,
        alreadySetup: true,
      });
    }

    /*
     * First try to find an invitation bound directly to the
     * authenticated Supabase user.
     */
    let {
      data: invitation,
      error: invitationError,
    } = await supabaseAdmin
      .from("charity_invitations")
      .select("id, charity_id")
      .eq("status", "sent")
      .gt(
        "expires_at",
        new Date().toISOString(),
      )
      .eq("auth_user_id", userId)
      .order("created_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (invitationError) {
      return send(res, 500, {
        ok: false,
        error: invitationError.message,
      });
    }

    /*
     * If the invited Supabase user ID has not yet been written to the
     * invitation, use the verified authenticated email as a fallback.
     */
    if (!invitation && userEmail) {
      const byEmail = await supabaseAdmin
        .from("charity_invitations")
        .select("id, charity_id")
        .eq("status", "sent")
        .gt(
          "expires_at",
          new Date().toISOString(),
        )
        .eq(
          "email",
          userEmail.trim().toLowerCase(),
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      invitation = byEmail.data;
      invitationError = byEmail.error;

      if (invitationError) {
        return send(res, 500, {
          ok: false,
          error: invitationError.message,
        });
      }
    }

    /*
     * Only a valid server-created invitation may select an existing
     * workspace. A public HMRC reference or Charity Commission number
     * must never be enough to claim an existing workspace.
     */
    const {
      data: existingCharity,
      error: charityLookupError,
    } = invitation
      ? await supabaseAdmin
          .from("charities")
          .select("id")
          .eq("id", invitation.charity_id)
          .single()
      : {
          data: null,
          error: null,
        };

    if (charityLookupError) {
      return send(res, 500, {
        ok: false,
        error: charityLookupError.message,
      });
    }

    let charityId =
      existingCharity?.id ?? null;

    /*
     * Complete the workspace that the operator created before sending
     * the invitation.
     */
    if (charityId && invitation) {
      const { error: updateError } =
        await supabaseAdmin
          .from("charities")
          .update({
            name,
            contact_email: contactEmail,
            charity_id: hmrcReference,
            charity_number:
              charityCommissionNumber,
            authorised_official_name:
              authorisedOfficialName,
            onboarding_status: "complete",
          })
          .eq("id", charityId);

      if (updateError) {
        return send(res, 500, {
          ok: false,
          error: updateError.message,
        });
      }
    }

    /*
     * A user without a workspace invitation follows the original
     * self-service flow and receives a newly created workspace.
     */
    if (!charityId) {
      const {
        data: createdCharity,
        error: createError,
      } = await supabaseAdmin
        .from("charities")
        .insert({
          name,
          contact_email: contactEmail,
          charity_id: hmrcReference,
          charity_number:
            charityCommissionNumber,
          authorised_official_name:
            authorisedOfficialName,
          created_by: userId,
          self_submit_enabled: false,
          onboarding_status: "complete",
        })
        .select("id")
        .single();

      if (createError) {
        return send(res, 500, {
          ok: false,
          error: createError.message,
        });
      }

      if (!createdCharity?.id) {
        return send(res, 500, {
          ok: false,
          error:
            "Charity created but no id returned",
        });
      }

      charityId = createdCharity.id;
    }

    const { error: linkError } =
      await supabaseAdmin
        .from("users")
        .update({
          charity_id: charityId,
        })
        .eq("id", userId);

    if (linkError) {
      return send(res, 500, {
        ok: false,
        error: linkError.message,
      });
    }

    if (invitation) {
      const { error: acceptanceError } =
        await supabaseAdmin
          .from("charity_invitations")
          .update({
            status: "accepted",
            auth_user_id: userId,
            accepted_at:
              new Date().toISOString(),
          })
          .eq("id", invitation.id)
          .eq("status", "sent");

      if (acceptanceError) {
        return send(res, 500, {
          ok: false,
          error: acceptanceError.message,
        });
      }
    }

    if (userEmail) {
      await migratePendingData(
        userEmail,
        charityId,
      );
    }

    await logActivity({
      userId,
      userEmail,
      action: "charity_setup_completed",
      targetType: "charity",
      targetId: charityId,
      details: `Charity name: ${name}`,
    });

    return send(res, 200, {
      ok: true,
      charity_id: charityId,
      alreadySetup: false,
    });
  } catch (error: any) {
    return send(res, 500, {
      ok: false,
      error:
        error?.message ?? "Server error",
    });
  }
}
