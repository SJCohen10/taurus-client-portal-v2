const catalyst = require("zcatalyst-sdk-node");
module.exports = (context, basicIO) => {
  const catalystApp = catalyst.initialize(context);
  const requestDetails = catalystApp
    .userManagement()
    .getSignupValidationRequest(basicIO);
  if (requestDetails) {
    basicIO.write(
      JSON.stringify({
        status: "success",
        user_details: {
          first_name: requestDetails.user_details.first_name,
          last_name: requestDetails.user_details.last_name,
          email_id: requestDetails.user_details.email_id,
          role_identifier: "App User",
          org_id: "",
        },
      })
    );
  }
  context.close();
};